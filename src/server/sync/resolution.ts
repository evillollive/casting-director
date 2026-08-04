import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";
import { enqueueRepositorySync } from "@/server/sync/enqueue";
import type { SyncEntry, SyncSnapshot } from "@/server/sync/reconcile";

export class SyncConflictNotFoundError extends Error {
  constructor() {
    super("Markdown sync conflict not found.");
    this.name = "SyncConflictNotFoundError";
  }
}

export class SyncConflictVersionError extends Error {
  constructor() {
    super("The markdown sync conflict changed after it was loaded.");
    this.name = "SyncConflictVersionError";
  }
}

function objectValue(value: Prisma.JsonValue): Record<string, unknown> {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value
    : {};
}

function conflictEntry(snapshot: Prisma.JsonValue): SyncEntry | null {
  const entry = objectValue(snapshot).entry;
  return entry && !Array.isArray(entry) && typeof entry === "object"
    ? entry as SyncEntry
    : null;
}

function entryString(entry: SyncEntry, key: string): string {
  const value = entry[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Sync conflict entry is missing ${key}.`);
  }
  return value;
}

async function applyDnrResolution(
  tx: Prisma.TransactionClient,
  principal: Pick<AuthenticatedPrincipal, "workspaceId" | "userId">,
  identity: string,
  databaseSnapshot: Prisma.JsonValue,
  entry: SyncEntry | null,
): Promise<void> {
  const metadata = objectValue(databaseSnapshot);
  const candidateId =
    typeof metadata.candidateId === "string" ? metadata.candidateId : null;
  const candidateVersion =
    typeof metadata.candidateVersion === "number"
      ? metadata.candidateVersion
      : null;
  const current = candidateId
    ? await tx.candidate.findFirst({
        where: { id: candidateId, workspaceId: principal.workspaceId },
        select: { id: true, handle: true, status: true, version: true },
      })
    : null;
  if (current && candidateVersion !== null && current.version !== candidateVersion) {
    throw new SyncConflictVersionError();
  }
  if (!entry) {
    if (!current) return;
    const cleared = await tx.candidate.updateMany({
      where: { id: current.id, version: current.version },
      data: {
        doNotResurface: false,
        doNotResurfaceDate: null,
        publicSyncNote: null,
        version: { increment: 1 },
      },
    });
    if (cleared.count !== 1) throw new SyncConflictVersionError();
    return;
  }

  const status = entryString(entry, "status") as
    | "NEW"
    | "CONTACTED"
    | "PASSED"
    | "CAST"
    | "MAYBE_LATER";
  const date = entry.date
    ? new Date(`${entryString(entry, "date")}T00:00:00.000Z`)
    : new Date();
  if (!current) {
    await tx.candidate.create({
      data: {
        workspaceId: principal.workspaceId,
        fingerprint: `markdown:${identity}`,
        name: entryString(entry, "name"),
        project: entry.project,
        status,
        doNotResurface: true,
        doNotResurfaceDate: date,
        publicSyncNote: entry.note,
      },
    });
    return;
  }
  const updated = await tx.candidate.updateMany({
    where: { id: current.id, version: current.version },
    data: {
      name: current.handle ? undefined : entryString(entry, "name"),
      project: entry.project,
      status,
      doNotResurface: true,
      doNotResurfaceDate: date,
      publicSyncNote: entry.note,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new SyncConflictVersionError();
  if (current.status !== status) {
    await tx.candidateStatusChange.create({
      data: {
        candidateId: current.id,
        authorId: principal.userId,
        fromStatus: current.status,
        toStatus: status,
      },
    });
  }
}

async function applyTasteResolution(
  tx: Prisma.TransactionClient,
  principal: Pick<AuthenticatedPrincipal, "workspaceId" | "userId">,
  weekOf: string,
  entry: SyncEntry | null,
): Promise<void> {
  const date = new Date(`${weekOf}T00:00:00.000Z`);
  const current = await tx.tasteLogEntry.findFirst({
    where: { workspaceId: principal.workspaceId, weekOf: date },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  if (!entry) {
    if (current) await tx.tasteLogEntry.delete({ where: { id: current.id } });
    return;
  }
  const note = entryString(entry, "note");
  if (!current) {
    await tx.tasteLogEntry.create({
      data: {
        workspaceId: principal.workspaceId,
        weekOf: date,
        note,
        createdById: principal.userId,
        updatedById: principal.userId,
        revisions: {
          create: { revision: 1, note, editedById: principal.userId },
        },
      },
    });
  } else if (current.note !== note) {
    await tx.tasteLogEntry.update({
      where: { id: current.id },
      data: {
        note,
        updatedById: principal.userId,
        version: { increment: 1 },
        revisions: {
          create: {
            revision: current.version + 1,
            note,
            editedById: principal.userId,
          },
        },
      },
    });
  }
}

export async function resolveSyncConflict(
  database: PrismaClient,
  principal: Pick<AuthenticatedPrincipal, "workspaceId" | "userId">,
  conflictId: string,
  input: { resolution: "DATABASE" | "MARKDOWN"; version: number },
) {
  return database.$transaction(async (tx) => {
    const conflict = await tx.markdownSyncConflict.findFirst({
      where: {
        id: conflictId,
        syncState: { workspaceId: principal.workspaceId },
        status: "OPEN",
      },
      include: { syncState: true },
    });
    if (!conflict) throw new SyncConflictNotFoundError();

    if (input.resolution === "MARKDOWN") {
      const entry = conflictEntry(conflict.markdownSnapshot);
      if (conflict.syncState.document === "DO_NOT_RESURFACE") {
        await applyDnrResolution(
          tx,
          principal,
          conflict.normalizedIdentity,
          conflict.databaseSnapshot,
          entry,
        );
      } else {
        await applyTasteResolution(
          tx,
          principal,
          conflict.normalizedIdentity,
          entry,
        );
      }
      const base = objectValue(conflict.syncState.baseSnapshot) as SyncSnapshot;
      if (entry) base[conflict.normalizedIdentity] = entry;
      else delete base[conflict.normalizedIdentity];
      await tx.markdownSyncState.update({
        where: { id: conflict.syncStateId },
        data: {
          baseSnapshot: base as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
    } else {
      await enqueueRepositorySync(tx, {
        workspaceId: principal.workspaceId,
        document: conflict.syncState.document,
        direction: "EXPORT",
        idempotencyKey: `conflict:${conflict.id}:database:${input.version}`,
      });
    }

    const updated = await tx.markdownSyncConflict.updateMany({
      where: { id: conflict.id, status: "OPEN", version: input.version },
      data: {
        status:
          input.resolution === "DATABASE"
            ? "RESOLVED_DATABASE"
            : "RESOLVED_MARKDOWN",
        resolvedById: principal.userId,
        resolvedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new SyncConflictVersionError();
    return { id: conflict.id, resolution: input.resolution };
  });
}
