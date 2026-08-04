import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { WorkerConfig } from "@/server/config";
import {
  heartbeatScanJob,
  LeaseLostError,
  type ClaimedScanJob,
} from "@/server/jobs/repository";
import {
  workerEventSchema,
  type WorkerEvent,
  type WorkerResultEvent,
} from "@/worker/protocol";

export class ScanExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ScanExecutionError";
  }
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ScanExecutionError(
      "INVALID_SNAPSHOT",
      "A persisted scan snapshot has an invalid shape.",
      false,
    );
  }
  return value;
}

function jsonArray(value: Prisma.JsonValue): Prisma.JsonArray {
  if (!Array.isArray(value)) {
    throw new ScanExecutionError(
      "INVALID_SNAPSHOT",
      "A persisted scan snapshot has an invalid shape.",
      false,
    );
  }
  return value;
}

async function buildRequest(database: PrismaClient, scanId: string) {
  const scan = await database.scan.findUnique({
    where: { id: scanId },
    include: {
      sources: { include: { source: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!scan) {
    throw new ScanExecutionError(
      "SCAN_NOT_FOUND",
      "The leased scan no longer exists.",
      false,
    );
  }
  const prompt = jsonObject(scan.promptSnapshot ?? {});
  if (typeof prompt.canonicalPrompt !== "string") {
    throw new ScanExecutionError(
      "INVALID_PROMPT_SNAPSHOT",
      "The scan does not contain a canonical prompt snapshot.",
      false,
    );
  }
  return {
    version: 1,
    scan_id: scan.id,
    run_date: scan.runDate.toISOString().slice(0, 10),
    source_keys: scan.sources.map((item) => item.source.key),
    max_candidates: 60,
    prompt_template: prompt.canonicalPrompt,
    model: jsonObject(scan.configSnapshot),
    tuning: jsonObject(scan.tuningSnapshot),
    taste_log: scan.tasteLogSnapshot,
    memory: jsonArray(scan.memorySnapshot ?? []),
    do_not_resurface: jsonArray(scan.doNotResurfaceSnapshot ?? []),
  };
}

async function persistSourceEvent(
  database: Prisma.TransactionClient,
  scanId: string,
  event: Extract<WorkerEvent, { type: "source" }>,
) {
  const source = await database.source.findUnique({
    where: { key: event.source_key },
    select: { id: true },
  });
  if (!source) {
    throw new ScanExecutionError(
      "UNKNOWN_SOURCE_EVENT",
      `The Python worker reported unknown source ${event.source_key}.`,
      false,
    );
  }
  const now = new Date();
  await database.scanSource.update({
    where: { scanId_sourceId: { scanId, sourceId: source.id } },
    data: {
      status:
        event.status === "running"
          ? "RUNNING"
          : event.status === "completed"
            ? "COMPLETED"
            : "FAILED",
      fetchedCount: event.fetched_count,
      errorCode: event.error_code,
      errorMessage: event.error_message,
      startedAt: event.status === "running" ? now : undefined,
      completedAt: event.status === "running" ? undefined : now,
      version: { increment: 1 },
    },
  });
}

async function persistEvent(
  database: PrismaClient,
  job: ClaimedScanJob,
  event: WorkerEvent,
) {
  await database.$transaction(async (tx) => {
    const now = new Date();
    const lease = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "scan_jobs"
      WHERE "id" = ${job.id}
        AND "status" = 'RUNNING'
        AND "leaseToken" = ${job.leaseToken}
        AND "leaseExpiresAt" > ${now}
      FOR UPDATE
    `;
    if (lease.length !== 1) throw new LeaseLostError();
    if (event.type === "source") {
      await persistSourceEvent(tx, job.scanId, event);
      return;
    }
    if (event.type === "progress") {
      await tx.scan.update({
        where: { id: job.scanId },
        data: {
          candidatesFetched: event.candidates_fetched,
          candidatesDeduped: event.candidates_deduped,
          candidatesScreened: event.candidates_screened,
          version: { increment: 1 },
        },
      });
      return;
    }
    if (event.type === "prompt") {
      const scan = await tx.scan.findUniqueOrThrow({
        where: { id: job.scanId },
        select: { promptSnapshot: true },
      });
      const existing = jsonObject(scan.promptSnapshot ?? {});
      await tx.scan.update({
        where: { id: job.scanId },
        data: {
          promptHash: event.prompt_hash,
          promptSnapshot: {
            ...existing,
            screeningPrompt: event.prompt,
          },
          version: { increment: 1 },
        },
      });
    }
  });
}

async function persistResult(
  database: PrismaClient,
  job: ClaimedScanJob,
  result: WorkerResultEvent,
) {
  const now = new Date();
  await database.$transaction(async (tx) => {
    const lease = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "scan_jobs"
      WHERE "id" = ${job.id}
        AND "status" = 'RUNNING'
        AND "leaseToken" = ${job.leaseToken}
        AND "leaseExpiresAt" > ${now}
      FOR UPDATE
    `;
    if (lease.length !== 1) throw new LeaseLostError();
    const scan = await tx.scan.findUniqueOrThrow({
      where: { id: job.scanId },
      select: { workspaceId: true },
    });
    const sources = await tx.source.findMany();
    const sourceByKey = new Map(sources.map((source) => [source.key, source]));
    const candidateIds = new Map<string, string>();
    const completed = result.status === "completed";

    for (const item of result.candidates) {
      const raw = item.candidate;
      const candidate = await tx.candidate.upsert({
        where: {
          workspaceId_fingerprint: {
            workspaceId: scan.workspaceId,
            fingerprint: raw.fingerprint,
          },
        },
        create: {
          workspaceId: scan.workspaceId,
          name: completed ? item.name : raw.name,
          handle: (completed ? item.handle : raw.handle) || null,
          project: (completed ? item.project : raw.project) || null,
          projectUrl: raw.project_url || null,
          fingerprint: raw.fingerprint,
          ...(completed
            ? {
                region: item.region === "unknown" ? null : item.region,
                hook: item.hook,
                whyNow: item.why_now,
                voice: item.voice,
                arc: item.arc,
                reach: item.reach,
                caveat: item.caveat || null,
                sensitivity: item.sensitivity || null,
                rationale: item.rationale,
                protagonistScore: item.protagonist,
                visibleHookScore: item.visible_hook,
                whyNowScore: item.why_now_score,
                voiceScore: item.voice_score,
                arcScore: item.arc_score,
                reachScore: item.reach_score,
                overallScore: item.overall,
                isEvergreen: item.is_evergreen,
                gatePassed: item.gate_passed,
                notForSurfacing: item.not_for_surfacing,
                parkedReason: item.parked_reason || null,
                firstScanId: job.scanId,
                latestScanId: job.scanId,
              }
            : {}),
        },
        update: completed
          ? {
              name: item.name,
              handle: item.handle || null,
              project: item.project,
              projectUrl: raw.project_url || null,
              region: item.region === "unknown" ? null : item.region,
              hook: item.hook,
              whyNow: item.why_now,
              voice: item.voice,
              arc: item.arc,
              reach: item.reach,
              caveat: item.caveat || null,
              sensitivity: item.sensitivity || null,
              rationale: item.rationale,
              protagonistScore: item.protagonist,
              visibleHookScore: item.visible_hook,
              whyNowScore: item.why_now_score,
              voiceScore: item.voice_score,
              arcScore: item.arc_score,
              reachScore: item.reach_score,
              overallScore: item.overall,
              isEvergreen: item.is_evergreen,
              gatePassed: item.gate_passed,
              notForSurfacing: item.not_for_surfacing ? true : undefined,
              parkedReason: item.parked_reason || null,
              latestScanId: job.scanId,
              lastSeenAt: now,
              version: { increment: 1 },
            }
          : {},
      });
      candidateIds.set(raw.fingerprint, candidate.id);
      if (completed) {
        await tx.candidate.updateMany({
          where: { id: candidate.id, firstScanId: null },
          data: { firstScanId: job.scanId },
        });
      }
      const source = sourceByKey.get(raw.source_family);
      if (!source) {
        throw new ScanExecutionError(
          "UNKNOWN_CANDIDATE_SOURCE",
          `Candidate ${raw.fingerprint} used unknown source ${raw.source_family}.`,
          false,
        );
      }
      await tx.candidateProvenance.upsert({
        where: {
          workspaceId_sourceId_fingerprint: {
            workspaceId: scan.workspaceId,
            sourceId: source.id,
            fingerprint: raw.fingerprint,
          },
        },
        create: {
          candidateId: candidate.id,
          workspaceId: scan.workspaceId,
          sourceId: source.id,
          sourceUrl: raw.source_url,
          fingerprint: raw.fingerprint,
          rawMetadata: { context: raw.context, source: raw.source },
        },
        update: {
          candidateId: candidate.id,
          sourceUrl: raw.source_url,
          rawMetadata: { context: raw.context, source: raw.source },
          lastSeenAt: now,
          version: { increment: 1 },
        },
      });
      await tx.scanCandidate.create({
        data: {
          scanId: job.scanId,
          candidateId: candidate.id,
          placement: item.placement,
          rank: item.rank,
          hook: item.hook,
          whyNow: item.why_now,
          voice: item.voice,
          arc: item.arc,
          reach: item.reach,
          caveat: item.caveat || null,
          sensitivity: item.sensitivity || null,
          rationale: item.rationale,
          protagonistScore: item.protagonist,
          visibleHookScore: item.visible_hook,
          whyNowScore: item.why_now_score,
          voiceScore: item.voice_score,
          arcScore: item.arc_score,
          reachScore: item.reach_score,
          overallScore: item.overall,
          isEvergreen: item.is_evergreen,
          gatePassed: item.gate_passed,
          notForSurfacing: item.not_for_surfacing,
          parkedReason: item.parked_reason || null,
          modelMetadata: { protocolVersion: 1 },
        },
      });
    }

    await tx.evaluatorViolation.createMany({
      data: result.violations.map((violation) => ({
        scanId: job.scanId,
        candidateId: violation.candidate_reference
          ? result.candidates
              .map((candidate) => ({
                reference: candidate.name,
                id: candidateIds.get(candidate.candidate.fingerprint),
              }))
              .find(({ reference }) =>
                violation.candidate_reference?.includes(reference),
              )?.id
          : undefined,
        code: violation.code,
        severity: violation.severity,
        message: violation.message,
        candidateReference: violation.candidate_reference,
      })),
    });

    await tx.scan.update({
      where: { id: job.scanId },
      data: {
        status: completed ? "COMPLETED" : "FAILED",
        completedAt: now,
        candidatesFetched: result.counts.candidates_fetched,
        candidatesDeduped: result.counts.candidates_deduped,
        candidatesScreened: result.counts.candidates_screened,
        shortlistCount: result.counts.shortlist_count,
        parkingCount: result.counts.parking_count,
        summary: result.source_messages.join(" ") || null,
        reportMarkdown: result.report_markdown,
        error: result.error,
        evalPassed: result.eval_passed,
        version: { increment: 1 },
      },
    });
    await tx.scanJob.update({
      where: { id: job.id },
      data: {
        status: completed ? "SUCCEEDED" : "FAILED",
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        failureCode: completed ? null : "EVALUATOR_REJECTED",
        lastError: result.error,
        version: { increment: 1 },
      },
    });
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function executeScanJob(
  database: PrismaClient,
  config: WorkerConfig,
  job: ClaimedScanJob,
): Promise<void> {
  const leaseMs = config.CASTING_WORKER_LEASE_SECONDS * 1_000;
  let child: ChildProcessWithoutNullStreams | undefined;
  let heartbeatFailure: LeaseLostError | undefined;
  const heartbeat = setInterval(() => {
    void heartbeatScanJob(database, job, leaseMs).catch(() => {
      heartbeatFailure = new LeaseLostError();
      child?.kill("SIGTERM");
    });
  }, Math.max(5_000, leaseMs / 3));

  try {
    const request = await buildRequest(database, job.scanId);
    await heartbeatScanJob(database, job, leaseMs);
    if (heartbeatFailure) throw heartbeatFailure;

    const spawned = spawn(
      config.CASTING_PYTHON_BIN,
      [resolve(process.cwd(), "tools/tier2_scan_worker.py")],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "pipe",
      },
    );
    child = spawned;
    let stderr = "";
    spawned.stderr.setEncoding("utf8");
    spawned.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_000);
    });
    let result: WorkerResultEvent | undefined;
    let fatal: Extract<WorkerEvent, { type: "fatal" }> | undefined;
    const exit = new Promise<number | null>((resolveExit, reject) => {
      spawned.once("error", reject);
      spawned.once("close", resolveExit);
    });
    spawned.stdin.end(JSON.stringify(request));
    const lines = createInterface({ input: spawned.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const event = workerEventSchema.parse(JSON.parse(line));
        if (event.type === "result") {
          result = event;
        } else if (event.type === "fatal") {
          fatal = event;
        } else {
          await persistEvent(database, job, event);
        }
      }
      const exitCode = await exit;
      if (heartbeatFailure) throw heartbeatFailure;
      if (fatal) {
        throw new ScanExecutionError(
          fatal.code,
          fatal.message,
          fatal.retryable,
        );
      }
      if (!result) {
        throw new ScanExecutionError(
          "PYTHON_WORKER_EXIT",
          `Python worker exited with ${exitCode}: ${stderr || "no diagnostic output"}`,
          true,
        );
      }
      await persistResult(database, job, result);
    } finally {
      lines.close();
    }
  } catch (error) {
    if (child && !child.killed) child.kill("SIGTERM");
    if (error instanceof ScanExecutionError || error instanceof LeaseLostError) {
      throw error;
    }
    throw new ScanExecutionError(
      "WORKER_PROTOCOL_ERROR",
      error instanceof Error ? error.message : String(error),
      false,
    );
  } finally {
    clearInterval(heartbeat);
  }
}
