import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type {
  tasteLogCreateSchema,
  tasteLogPatchSchema,
  tasteLogQuerySchema,
} from "@/domain/api-contract";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";
import { enqueueRepositorySync } from "@/server/sync/enqueue";

type TasteLogQuery = z.infer<typeof tasteLogQuerySchema>;
type TasteLogCreate = z.infer<typeof tasteLogCreateSchema>;
type TasteLogPatch = z.infer<typeof tasteLogPatchSchema>;

export class TasteLogNotFoundError extends Error {
  constructor() {
    super("Taste-log entry not found.");
    this.name = "TasteLogNotFoundError";
  }
}

export class TasteLogVersionConflictError extends Error {
  constructor() {
    super("The taste-log entry changed after it was loaded.");
    this.name = "TasteLogVersionConflictError";
  }
}

export class InvalidTasteLogCursorError extends Error {
  constructor() {
    super("The taste-log cursor is invalid.");
    this.name = "InvalidTasteLogCursorError";
  }
}

const tasteLogInclude = {
  createdBy: {
    select: { id: true, displayName: true, email: true },
  },
  updatedBy: {
    select: { id: true, displayName: true, email: true },
  },
  revisions: {
    include: {
      editedBy: {
        select: { id: true, displayName: true, email: true },
      },
    },
    orderBy: { revision: "desc" as const },
  },
} satisfies Prisma.TasteLogEntryInclude;

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): string {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { v?: unknown; id?: unknown };
    if (value.v !== 1 || typeof value.id !== "string" || !value.id) {
      throw new InvalidTasteLogCursorError();
    }
    return value.id;
  } catch (error) {
    if (error instanceof InvalidTasteLogCursorError) throw error;
    throw new InvalidTasteLogCursorError();
  }
}

export async function listTasteLog(
  database: PrismaClient,
  workspaceId: string,
  query: TasteLogQuery,
) {
  const cursorId = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursorId) {
    const exists = await database.tasteLogEntry.findFirst({
      where: { id: cursorId, workspaceId },
      select: { id: true },
    });
    if (!exists) throw new InvalidTasteLogCursorError();
  }
  const rows = await database.tasteLogEntry.findMany({
    where: { workspaceId },
    include: tasteLogInclude,
    orderBy: [
      { weekOf: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: cursorId ? 1 : 0,
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  if (hasMore) rows.pop();
  return {
    items: rows,
    nextCursor:
      hasMore && rows.length > 0 ? encodeCursor(rows.at(-1)!.id) : null,
  };
}

export async function createTasteLogEntry(
  database: PrismaClient,
  principal: AuthenticatedPrincipal,
  input: TasteLogCreate,
) {
  return database.$transaction(async (tx) => {
    const created = await tx.tasteLogEntry.create({
      data: {
        workspaceId: principal.workspaceId,
        weekOf: new Date(`${input.weekOf}T00:00:00.000Z`),
        note: input.note,
        createdById: principal.userId,
        updatedById: principal.userId,
        revisions: {
          create: {
            revision: 1,
            note: input.note,
            editedById: principal.userId,
          },
        },
      },
      include: tasteLogInclude,
    });
    await enqueueRepositorySync(tx, {
      workspaceId: principal.workspaceId,
      document: "TASTE_LOG",
      direction: "EXPORT",
      idempotencyKey: `taste:${created.id}:1`,
    });
    return created;
  });
}

export async function updateTasteLogEntry(
  database: PrismaClient,
  principal: AuthenticatedPrincipal,
  entryId: string,
  input: TasteLogPatch,
) {
  return database.$transaction(async (tx) => {
    const current = await tx.tasteLogEntry.findFirst({
      where: { id: entryId, workspaceId: principal.workspaceId },
      select: { id: true },
    });
    if (!current) throw new TasteLogNotFoundError();

    const updated = await tx.tasteLogEntry.updateMany({
      where: {
        id: entryId,
        workspaceId: principal.workspaceId,
        version: input.version,
      },
      data: {
        note: input.note,
        updatedById: principal.userId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new TasteLogVersionConflictError();
    await tx.tasteLogEntryRevision.create({
      data: {
        tasteLogEntryId: entryId,
        revision: input.version + 1,
        note: input.note,
        editedById: principal.userId,
      },
    });
    await enqueueRepositorySync(tx, {
      workspaceId: principal.workspaceId,
      document: "TASTE_LOG",
      direction: "EXPORT",
      idempotencyKey: `taste:${entryId}:${input.version + 1}`,
    });
    return tx.tasteLogEntry.findFirstOrThrow({
      where: { id: entryId, workspaceId: principal.workspaceId },
      include: tasteLogInclude,
    });
  });
}
