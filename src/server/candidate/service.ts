import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type {
  candidateBulkPatchSchema,
  candidatePatchSchema,
  candidateQuerySchema,
} from "@/domain/api-contract";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";

type CandidateQuery = z.infer<typeof candidateQuerySchema>;
type CandidatePatch = z.infer<typeof candidatePatchSchema>;
type CandidateBulkPatch = z.infer<typeof candidateBulkPatchSchema>;

export class CandidateNotFoundError extends Error {
  constructor(readonly candidateIds: string[] = []) {
    super(
      candidateIds.length > 1
        ? "One or more candidates were not found."
        : "Candidate not found.",
    );
    this.name = "CandidateNotFoundError";
  }
}

export class CandidateVersionConflictError extends Error {
  constructor() {
    super("The candidate changed after it was loaded.");
    this.name = "CandidateVersionConflictError";
  }
}

export class CandidateTagsNotFoundError extends Error {
  constructor(readonly tagIds: string[]) {
    super("One or more tags were not found in this workspace.");
    this.name = "CandidateTagsNotFoundError";
  }
}

export class InvalidCandidateCursorError extends Error {
  constructor() {
    super("The candidate cursor is invalid for this query.");
    this.name = "InvalidCandidateCursorError";
  }
}

export class CandidateBulkConflictError extends Error {
  constructor() {
    super("Candidates changed while the bulk update was being applied.");
    this.name = "CandidateBulkConflictError";
  }
}

const candidateInclude = {
  tags: {
    include: { tag: true },
    orderBy: { createdAt: "asc" as const },
  },
  provenance: {
    include: {
      source: {
        select: { id: true, key: true, displayName: true, family: true },
      },
    },
    orderBy: { lastSeenAt: "desc" as const },
  },
  notes: {
    include: {
      author: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  statusChanges: {
    include: {
      author: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.CandidateInclude;

type CursorPayload = {
  v: 1;
  id: string;
  sort: CandidateQuery["sort"];
  direction: CandidateQuery["direction"];
  filters: string;
  value: string | number | null;
};

function cursorFilters(query: CandidateQuery): string {
  return JSON.stringify({
    query: query.query ?? null,
    status: query.status ?? null,
    tag: query.tag ?? null,
    sourceFamily: query.sourceFamily ?? null,
    region: query.region ?? null,
    minimumOverallScore: query.minimumOverallScore ?? null,
    isEvergreen: query.isEvergreen ?? null,
    gatePassed: query.gatePassed ?? null,
    doNotResurface: query.doNotResurface ?? null,
    notForSurfacing: query.notForSurfacing ?? null,
  });
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string,
  query: CandidateQuery,
): CursorPayload {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorPayload>;
    if (
      value.v !== 1 ||
      typeof value.id !== "string" ||
      value.id.length === 0 ||
      value.sort !== query.sort ||
      value.direction !== query.direction ||
      value.filters !== cursorFilters(query) ||
      !validCursorValue(value.sort, value.value)
    ) {
      throw new InvalidCandidateCursorError();
    }
    return value as CursorPayload;
  } catch (error) {
    if (error instanceof InvalidCandidateCursorError) throw error;
    throw new InvalidCandidateCursorError();
  }
}

function validCursorValue(
  sort: CandidateQuery["sort"],
  value: unknown,
): value is CursorPayload["value"] {
  if (sort === "score") return value === null || typeof value === "number";
  if (typeof value !== "string") return false;
  return sort !== "updatedAt" || !Number.isNaN(Date.parse(value));
}

function cursorBoundary(
  cursor: CursorPayload,
): Prisma.CandidateWhereInput {
  const comparison = cursor.direction === "desc" ? "lt" : "gt";
  const idAfter = { [comparison]: cursor.id };
  if (cursor.sort === "name") {
    const value = cursor.value as string;
    return {
      OR: [
        { name: { [comparison]: value } },
        { name: value, id: idAfter },
      ],
    };
  }
  if (cursor.sort === "updatedAt") {
    const value = new Date(cursor.value as string);
    return {
      OR: [
        { updatedAt: { [comparison]: value } },
        { updatedAt: value, id: idAfter },
      ],
    };
  }
  if (cursor.value === null) {
    return { overallScore: null, id: idAfter };
  }
  const value = cursor.value as number;
  return {
    OR: [
      { overallScore: { [comparison]: value } },
      { overallScore: value, id: idAfter },
      { overallScore: null },
    ],
  };
}

function cursorValue(
  candidate: { updatedAt: Date; name: string; overallScore: number | null },
  sort: CandidateQuery["sort"],
): CursorPayload["value"] {
  if (sort === "score") return candidate.overallScore;
  if (sort === "name") return candidate.name;
  return candidate.updatedAt.toISOString();
}

function candidateOrderBy(
  query: Pick<CandidateQuery, "sort" | "direction">,
): Prisma.CandidateOrderByWithRelationInput[] {
  const direction = query.direction;
  if (query.sort === "name") return [{ name: direction }, { id: direction }];
  if (query.sort === "score") {
    return [{ overallScore: { sort: direction, nulls: "last" } }, { id: direction }];
  }
  return [{ updatedAt: direction }, { id: direction }];
}

function candidateWhere(
  workspaceId: string,
  query: CandidateQuery,
): Prisma.CandidateWhereInput {
  const text = query.query
    ? [
        { name: { contains: query.query, mode: "insensitive" as const } },
        { handle: { contains: query.query, mode: "insensitive" as const } },
        { project: { contains: query.query, mode: "insensitive" as const } },
        { hook: { contains: query.query, mode: "insensitive" as const } },
        { rationale: { contains: query.query, mode: "insensitive" as const } },
      ]
    : undefined;
  return {
    workspaceId,
    mergedIntoId: null,
    status: query.status,
    region: query.region
      ? { contains: query.region, mode: "insensitive" }
      : undefined,
    overallScore:
      query.minimumOverallScore === undefined
        ? undefined
        : { gte: query.minimumOverallScore },
    isEvergreen: query.isEvergreen,
    gatePassed: query.gatePassed,
    doNotResurface: query.doNotResurface,
    notForSurfacing: query.notForSurfacing,
    OR: text,
    tags: query.tag
      ? {
          some: {
            tag: {
              OR: [
                { id: query.tag },
                { slug: query.tag },
                { name: { equals: query.tag, mode: "insensitive" } },
              ],
            },
          },
        }
      : undefined,
    provenance: query.sourceFamily
      ? { some: { source: { family: query.sourceFamily } } }
      : undefined,
  };
}

export async function listCandidates(
  database: PrismaClient,
  workspaceId: string,
  query: CandidateQuery,
) {
  const cursor = query.cursor ? decodeCursor(query.cursor, query) : undefined;
  const filters = candidateWhere(workspaceId, query);

  const rows = await database.candidate.findMany({
    where: cursor ? { AND: [filters, cursorBoundary(cursor)] } : filters,
    include: candidateInclude,
    orderBy: candidateOrderBy(query),
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  if (hasMore) rows.pop();
  const last = rows.at(-1);
  return {
    items: rows,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: 1,
            id: last.id,
            sort: query.sort,
            direction: query.direction,
            filters: cursorFilters(query),
            value: cursorValue(last, query.sort),
          })
        : null,
  };
}

async function assertWorkspaceTags(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  tagIds: string[] | undefined,
) {
  if (!tagIds) return;
  const tags = await tx.tag.findMany({
    where: { workspaceId, id: { in: tagIds } },
    select: { id: true },
  });
  const found = new Set(tags.map(({ id }) => id));
  const missing = tagIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new CandidateTagsNotFoundError(missing);
}

function candidateUpdateData(
  input: Pick<
    CandidatePatch,
    | "status"
    | "doNotResurface"
    | "notForSurfacing"
    | "parkedReason"
  >,
): Prisma.CandidateUpdateManyMutationInput {
  return {
    status: input.status,
    doNotResurface: input.doNotResurface,
    notForSurfacing: input.notForSurfacing,
    parkedReason: input.parkedReason,
    version: { increment: 1 },
  };
}

export async function updateCandidate(
  database: PrismaClient,
  principal: AuthenticatedPrincipal,
  candidateId: string,
  input: CandidatePatch,
) {
  return database.$transaction(async (tx) => {
    const current = await tx.candidate.findFirst({
      where: { id: candidateId, workspaceId: principal.workspaceId },
      select: { id: true, status: true },
    });
    if (!current) throw new CandidateNotFoundError([candidateId]);
    await assertWorkspaceTags(tx, principal.workspaceId, input.tagIds);

    const updated = await tx.candidate.updateMany({
      where: {
        id: candidateId,
        workspaceId: principal.workspaceId,
        version: input.version,
      },
      data: candidateUpdateData(input),
    });
    if (updated.count !== 1) throw new CandidateVersionConflictError();

    if (input.tagIds) {
      await tx.candidateTag.deleteMany({ where: { candidateId } });
      if (input.tagIds.length > 0) {
        await tx.candidateTag.createMany({
          data: input.tagIds.map((tagId) => ({ candidateId, tagId })),
        });
      }
    }
    if (input.note) {
      await tx.candidateNote.create({
        data: {
          candidateId,
          authorId: principal.userId,
          body: input.note,
        },
      });
    }
    if (input.status && input.status !== current.status) {
      await tx.candidateStatusChange.create({
        data: {
          candidateId,
          authorId: principal.userId,
          fromStatus: current.status,
          toStatus: input.status,
        },
      });
    }

    return tx.candidate.findFirstOrThrow({
      where: { id: candidateId, workspaceId: principal.workspaceId },
      include: candidateInclude,
    });
  });
}

export async function bulkUpdateCandidates(
  database: PrismaClient,
  principal: AuthenticatedPrincipal,
  input: CandidateBulkPatch,
) {
  try {
    return await database.$transaction(
      async (tx) => {
        const candidates = await tx.candidate.findMany({
          where: {
            workspaceId: principal.workspaceId,
            id: { in: input.candidateIds },
          },
          select: { id: true, status: true },
        });
        const found = new Set(candidates.map(({ id }) => id));
        const missing = input.candidateIds.filter((id) => !found.has(id));
        if (missing.length > 0) throw new CandidateNotFoundError(missing);
        await assertWorkspaceTags(tx, principal.workspaceId, input.tagIds);

        const updated = await tx.candidate.updateMany({
          where: {
            workspaceId: principal.workspaceId,
            id: { in: input.candidateIds },
          },
          data: candidateUpdateData(input),
        });
        if (updated.count !== input.candidateIds.length) {
          throw new CandidateNotFoundError(input.candidateIds);
        }

        if (input.tagIds) {
          await tx.candidateTag.deleteMany({
            where: { candidateId: { in: input.candidateIds } },
          });
          if (input.tagIds.length > 0) {
            await tx.candidateTag.createMany({
              data: input.candidateIds.flatMap((candidateId) =>
                input.tagIds!.map((tagId) => ({ candidateId, tagId })),
              ),
            });
          }
        }
        if (input.status) {
          const changes = candidates
            .filter(({ status }) => status !== input.status)
            .map(({ id, status }) => ({
              candidateId: id,
              authorId: principal.userId,
              fromStatus: status,
              toStatus: input.status!,
            }));
          if (changes.length > 0) {
            await tx.candidateStatusChange.createMany({ data: changes });
          }
        }
        return { updatedCount: updated.count };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      throw new CandidateBulkConflictError();
    }
    throw error;
  }
}
