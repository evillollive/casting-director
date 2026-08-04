import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TASTE_LOG_INJECT_LIMIT } from "@/domain/editorial-contract";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";
import { hashSnapshot, hashText } from "@/server/scan/snapshots";

export class UnknownScanSourcesError extends Error {
  constructor(readonly sourceKeys: string[]) {
    super(`Unknown or inactive scan sources: ${sourceKeys.join(", ")}.`);
    this.name = "UnknownScanSourcesError";
  }
}

export class ScanNotFoundError extends Error {
  constructor() {
    super("Scan not found.");
    this.name = "ScanNotFoundError";
  }
}

type CreateScanInput = {
  runDate: string;
  sourceKeys: string[];
};

type ScanQuery = {
  cursor?: string;
  limit: number;
  status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  from?: string;
  to?: string;
  summary?: string;
};

const scanInclude = {
  sources: {
    include: { source: { select: { key: true, displayName: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  evaluatorViolations: { orderBy: { createdAt: "asc" as const } },
  job: true,
} satisfies Prisma.ScanInclude;

let canonicalPromptPromise: Promise<string> | undefined;

function canonicalPrompt(): Promise<string> {
  canonicalPromptPromise ??= readFile(
    resolve(process.cwd(), "prompts/tier0-weekly-scan.md"),
    "utf8",
  );
  return canonicalPromptPromise;
}

function publicModelConfig() {
  return {
    endpointUrl: process.env.CASTING_LLM_API_URL ?? null,
    model: process.env.CASTING_LLM_MODEL ?? null,
    timeoutSeconds: process.env.CASTING_LLM_TIMEOUT_SECONDS ?? "120",
    temperature: 0.2,
  };
}

export async function createOrGetActiveScan(
  database: PrismaClient,
  principal: AuthenticatedPrincipal,
  input: CreateScanInput,
) {
  const prompt = await canonicalPrompt();
  const configSnapshot = publicModelConfig();

  try {
    return await database.$transaction(async (tx) => {
      const active = await tx.scan.findFirst({
        where: {
          workspaceId: principal.workspaceId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        include: scanInclude,
      });
      if (active) return { scan: active, created: false };

      const sources = await tx.source.findMany({
        where: {
          key: { in: input.sourceKeys },
          active: true,
          executable: true,
        },
        orderBy: { key: "asc" },
      });
      const found = new Set(sources.map((source) => source.key));
      const missing = input.sourceKeys.filter((key) => !found.has(key));
      if (missing.length > 0) throw new UnknownScanSourcesError(missing);

      const tuning = await tx.tuningConfig.findUnique({
        where: { workspaceId: principal.workspaceId },
        include: {
          activeRevision: {
            include: { items: { orderBy: { position: "asc" } } },
          },
        },
      });
      const revision = tuning?.activeRevision;
      const tuningData = {
        revisionId: revision?.id ?? null,
        revision: revision?.revision ?? null,
        beat: revision?.beat ?? "",
        hardNos:
          revision?.items
            .filter((item) => item.kind === "HARD_NO")
            .map((item) => item.value) ?? [],
        moreOf:
          revision?.items
            .filter((item) => item.kind === "MORE_OF")
            .map((item) => item.value) ?? [],
      };
      const tasteRows = await tx.tasteLogEntry.findMany({
        where: { workspaceId: principal.workspaceId },
        orderBy: [{ weekOf: "desc" }, { createdAt: "desc" }],
        take: TASTE_LOG_INJECT_LIMIT,
        select: { id: true, weekOf: true, note: true, version: true },
      });
      const tasteData = tasteRows.map((entry) => ({
        ...entry,
        weekOf: entry.weekOf.toISOString().slice(0, 10),
      }));
      const memoryRows = await tx.candidate.findMany({
        where: { workspaceId: principal.workspaceId, mergedIntoId: null },
        select: {
          name: true,
          handle: true,
          project: true,
          projectUrl: true,
          fingerprint: true,
          doNotResurface: true,
          scanAppearances: {
            where: {
              scan: { status: "COMPLETED", evalPassed: true },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              placement: true,
              scan: { select: { runDate: true } },
            },
          },
        },
      });
      const memoryData = memoryRows
        .filter((candidate) => candidate.scanAppearances[0])
        .map((candidate) => {
          const appearance = candidate.scanAppearances[0]!;
          return {
            name: candidate.name,
            handle: candidate.handle ?? "",
            project: candidate.project ?? "",
            project_url: candidate.projectUrl ?? "",
            fingerprint: candidate.fingerprint,
            state:
              appearance.placement === "PARKING_LOT"
                ? "parked"
                : "permanent",
            seen_on: appearance.scan.runDate.toISOString().slice(0, 10),
          };
        });
      const doNotResurfaceData = memoryRows
        .filter((candidate) => candidate.doNotResurface)
        .map((candidate) => ({
          name: candidate.name,
          handle: candidate.handle ?? "",
          project: candidate.project ?? "",
        }));

      const scan = await tx.scan.create({
        data: {
          workspaceId: principal.workspaceId,
          triggeredById: principal.userId,
          tuningRevisionId: revision?.id,
          runDate: new Date(`${input.runDate}T00:00:00.000Z`),
          promptHash: hashText(prompt),
          promptSnapshot: { canonicalPrompt: prompt },
          configHash: hashSnapshot(configSnapshot),
          configSnapshot,
          tuningHash: hashSnapshot(tuningData),
          tuningSnapshot: tuningData,
          tasteLogHash: hashSnapshot(tasteData),
          tasteLogSnapshot: tasteData,
          memoryHash: hashSnapshot(memoryData),
          memorySnapshot: memoryData,
          doNotResurfaceHash: hashSnapshot(doNotResurfaceData),
          doNotResurfaceSnapshot: doNotResurfaceData,
          sources: {
            create: sources.map((source) => ({ sourceId: source.id })),
          },
          job: {
            create: {
              maxAttempts: Number(
                process.env.CASTING_WORKER_MAX_ATTEMPTS ?? "3",
              ),
            },
          },
        },
        include: scanInclude,
      });
      return { scan, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const active = await database.scan.findFirst({
        where: {
          workspaceId: principal.workspaceId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        include: scanInclude,
      });
      if (active) return { scan: active, created: false };
    }
    throw error;
  }
}

export async function listScans(
  database: PrismaClient,
  workspaceId: string,
  query: ScanQuery,
) {
  const items = await database.scan.findMany({
    where: {
      workspaceId,
      status: query.status,
      runDate: {
        gte: query.from
          ? new Date(`${query.from}T00:00:00.000Z`)
          : undefined,
        lte: query.to ? new Date(`${query.to}T00:00:00.000Z`) : undefined,
      },
      summary: query.summary
        ? { contains: query.summary, mode: "insensitive" }
        : undefined,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: query.cursor ? { id: query.cursor } : undefined,
    skip: query.cursor ? 1 : 0,
    take: query.limit + 1,
    include: scanInclude,
  });
  const hasMore = items.length > query.limit;
  if (hasMore) items.pop();
  return {
    items: items.map((scan) => ({
      id: scan.id,
      status: scan.status,
      runDate: scan.runDate,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
      createdAt: scan.createdAt,
      candidatesFetched: scan.candidatesFetched,
      candidatesDeduped: scan.candidatesDeduped,
      candidatesScreened: scan.candidatesScreened,
      shortlistCount: scan.shortlistCount,
      parkingCount: scan.parkingCount,
      summary: scan.summary,
      error: scan.error,
      evalPassed: scan.evalPassed,
      sourceProgress: scan.sources,
      evaluatorViolations: scan.evaluatorViolations,
      job: scan.job,
      shippable: scan.status === "COMPLETED" && scan.evalPassed === true,
    })),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function getScan(
  database: PrismaClient,
  workspaceId: string,
  id: string,
) {
  const scan = await database.scan.findFirst({
    where: { id, workspaceId },
    include: {
      ...scanInclude,
      candidates: {
        include: {
          candidate: {
            select: {
              name: true,
              handle: true,
              project: true,
              projectUrl: true,
            },
          },
        },
        orderBy: [{ placement: "asc" }, { rank: "asc" }],
      },
    },
  });
  if (!scan) throw new ScanNotFoundError();
  const shippable = scan.status === "COMPLETED" && scan.evalPassed === true;
  return {
    ...scan,
    reportMarkdown: shippable ? scan.reportMarkdown : null,
    diagnosticReportMarkdown:
      scan.status === "FAILED" ? scan.reportMarkdown : null,
    shippable,
  };
}
