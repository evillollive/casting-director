import type {
  MarkdownDocumentKind,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";
import {
  normalizeDnrIdentities,
  parseDoNotResurface,
  parseTasteLog,
  renderDoNotResurface,
  renderTasteLog,
  type DoNotResurfaceRow,
} from "@/server/import/markdown-memory";
import { hashSnapshot, hashText } from "@/server/scan/snapshots";
import type { RepositoryProvider } from "@/server/repository/provider";
import {
  reconcileSnapshots,
  type SyncEntry,
  type SyncSnapshot,
} from "@/server/sync/reconcile";

const DOCUMENT_PATHS: Record<MarkdownDocumentKind, string> = {
  DO_NOT_RESURFACE: "rolodex/do-not-resurface.md",
  TASTE_LOG: "rolodex/taste-log.md",
};

export class SyncConflictsPendingError extends Error {
  constructor() {
    super("Open markdown sync conflicts require explicit human resolution.");
    this.name = "SyncConflictsPendingError";
  }
}

export class RepositoryChangedError extends Error {
  constructor() {
    super("The repository changed after the last import; reconcile before exporting.");
    this.name = "RepositoryChangedError";
  }
}

export class SyncStateVersionError extends Error {
  constructor() {
    super("Markdown sync state changed during reconciliation; retry the operation.");
    this.name = "SyncStateVersionError";
  }
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function asSnapshot(value: Prisma.JsonValue | null | undefined): SyncSnapshot {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as SyncSnapshot;
}

function markdownSnapshot(
  document: MarkdownDocumentKind,
  content: string,
): SyncSnapshot {
  if (document === "DO_NOT_RESURFACE") {
    return Object.fromEntries(
      parseDoNotResurface(content).map((row) => [
        row.normalizedIdentity,
        {
          name: row.name,
          project: row.project,
          status: row.status,
          date: row.date,
          note: row.note,
        },
      ]),
    );
  }
  return Object.fromEntries(
    parseTasteLog(content).map((row) => [
      row.weekOf,
      { weekOf: row.weekOf, note: row.note },
    ]),
  );
}

async function databaseSnapshot(
  database: PrismaClient | Prisma.TransactionClient,
  workspaceId: string,
  document: MarkdownDocumentKind,
): Promise<SyncSnapshot> {
  if (document === "TASTE_LOG") {
    const rows = await database.tasteLogEntry.findMany({
      where: { workspaceId },
      orderBy: [{ weekOf: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
      select: { weekOf: true, note: true },
    });
    const snapshot: SyncSnapshot = {};
    for (const row of rows) {
      const key = dateOnly(row.weekOf);
      if (!snapshot[key]) snapshot[key] = { weekOf: key, note: row.note };
    }
    return snapshot;
  }

  const rows = await database.candidate.findMany({
    where: { workspaceId, mergedIntoId: null, doNotResurface: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      name: true,
      handle: true,
      project: true,
      status: true,
      doNotResurfaceDate: true,
      updatedAt: true,
      publicSyncNote: true,
    },
  });
  const identities = normalizeDnrIdentities(
    rows.map((row) => row.handle || row.name),
  );
  const snapshot: SyncSnapshot = {};
  rows.forEach((row, index) => {
    const key = identities[index] ?? "";
    if (key.length < 3) return;
    if (snapshot[key]) {
      throw new Error(`Multiple database candidates normalize to "${key}".`);
    }
    snapshot[key] = {
      name: row.handle || row.name,
      project: row.project,
      status: row.status,
      date: dateOnly(row.doNotResurfaceDate ?? row.updatedAt),
      note: row.publicSyncNote ?? "Tracked by Tier 2.",
    };
  });
  return snapshot;
}

function entryString(entry: SyncEntry, key: string): string {
  const value = entry[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Sync entry is missing ${key}.`);
  }
  return value;
}

type CandidateIdentityRow = {
  id: string;
  name: string;
  handle: string | null;
  project: string | null;
  status: DoNotResurfaceRow["status"];
  doNotResurface: boolean;
  doNotResurfaceDate: Date | null;
  publicSyncNote: string | null;
  version: number;
};

async function loadCandidateIdentityIndex(
  database: PrismaClient,
  workspaceId: string,
): Promise<Map<string, CandidateIdentityRow>> {
  const candidates = await database.candidate.findMany({
    where: { workspaceId, mergedIntoId: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      handle: true,
      project: true,
      status: true,
      doNotResurface: true,
      doNotResurfaceDate: true,
      publicSyncNote: true,
      version: true,
    },
  });
  const identities = normalizeDnrIdentities(
    candidates.map((candidate) => candidate.handle || candidate.name),
  );
  const index = new Map<string, CandidateIdentityRow>();
  candidates.forEach((candidate, candidateIndex) => {
    const identity = identities[candidateIndex];
    if (!identity || identity.length < 3) return;
    if (index.has(identity)) {
      throw new Error(`Multiple database candidates normalize to "${identity}".`);
    }
    index.set(identity, candidate);
  });
  return index;
}

async function applyDnrEntry(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  existing: CandidateIdentityRow | null,
  identity: string,
  entry: SyncEntry,
): Promise<void> {
  const date = entry.date
    ? new Date(`${entryString(entry, "date")}T00:00:00.000Z`)
    : new Date();
  const data = {
    name: existing?.handle ? undefined : entryString(entry, "name"),
    project: entry.project,
    status: entryString(entry, "status") as DoNotResurfaceRow["status"],
    doNotResurface: true,
    doNotResurfaceDate: date,
    publicSyncNote: entry.note,
    version: { increment: 1 },
  };
  if (existing) {
    const unchanged =
      (existing.handle ? true : existing.name === data.name) &&
      existing.project === data.project &&
      existing.status === data.status &&
      existing.doNotResurface &&
      existing.doNotResurfaceDate !== null &&
      dateOnly(existing.doNotResurfaceDate) === dateOnly(date) &&
      existing.publicSyncNote === data.publicSyncNote;
    if (unchanged) return;
    const updated = await tx.candidate.updateMany({
      where: { id: existing.id, version: existing.version },
      data,
    });
    if (updated.count !== 1) throw new SyncStateVersionError();
    if (existing.status !== data.status) {
      await tx.candidateStatusChange.create({
        data: {
          candidateId: existing.id,
          authorId: actorId,
          fromStatus: existing.status,
          toStatus: data.status,
        },
      });
    }
    return;
  }
  await tx.candidate.create({
    data: {
      workspaceId,
      fingerprint: `markdown:${identity}`,
      name: data.name ?? entryString(entry, "name"),
      project: data.project,
      status: data.status,
      doNotResurface: true,
      doNotResurfaceDate: date,
      publicSyncNote: data.publicSyncNote,
    },
  });
}

async function applyTasteEntry(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  entry: SyncEntry,
): Promise<void> {
  const weekOf = entryString(entry, "weekOf");
  const note = entryString(entry, "note");
  const date = new Date(`${weekOf}T00:00:00.000Z`);
  const current = await tx.tasteLogEntry.findFirst({
    where: { workspaceId, weekOf: date },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  if (!current) {
    await tx.tasteLogEntry.create({
      data: {
        workspaceId,
        weekOf: date,
        note,
        createdById: actorId,
        updatedById: actorId,
        revisions: {
          create: { revision: 1, note, editedById: actorId },
        },
      },
    });
  } else if (current.note !== note) {
    await tx.tasteLogEntry.update({
      where: { id: current.id },
      data: {
        note,
        updatedById: actorId,
        version: { increment: 1 },
        revisions: {
          create: {
            revision: current.version + 1,
            note,
            editedById: actorId,
          },
        },
      },
    });
  }
}

async function applyEntry(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  document: MarkdownDocumentKind,
  candidateIndex: Map<string, CandidateIdentityRow>,
  key: string,
  entry: SyncEntry,
): Promise<void> {
  if (document === "DO_NOT_RESURFACE") {
    await applyDnrEntry(
      tx,
      workspaceId,
      actorId,
      candidateIndex.get(key) ?? null,
      key,
      entry,
    );
  } else {
    await applyTasteEntry(tx, workspaceId, actorId, entry);
  }
}

export async function importRepositoryDocument(
  database: PrismaClient,
  provider: RepositoryProvider,
  principal: Pick<AuthenticatedPrincipal, "workspaceId" | "userId">,
  document: MarkdownDocumentKind,
) {
  const repository = await provider.read(DOCUMENT_PATHS[document]);
  const markdown = markdownSnapshot(document, repository.content);
  await database.markdownSyncState.upsert({
    where: { workspaceId_document: { workspaceId: principal.workspaceId, document } },
    create: { workspaceId: principal.workspaceId, document },
    update: {},
  });
  const currentState = await database.markdownSyncState.findUniqueOrThrow({
    where: { workspaceId_document: { workspaceId: principal.workspaceId, document } },
  });
  const currentDatabase = await databaseSnapshot(
    database,
    principal.workspaceId,
    document,
  );
  const candidateIndex =
    document === "DO_NOT_RESURFACE"
      ? await loadCandidateIdentityIndex(database, principal.workspaceId)
      : new Map<string, CandidateIdentityRow>();
  const reconciliation = reconcileSnapshots(
    asSnapshot(currentState?.baseSnapshot),
    currentDatabase,
    markdown,
  );

  await database.$transaction(async (tx) => {
    for (const imported of reconciliation.imports) {
      await applyEntry(
        tx,
        principal.workspaceId,
        principal.userId,
        document,
        candidateIndex,
        imported.key,
        imported.entry,
      );
    }
    for (const conflict of reconciliation.conflicts) {
      const databaseCandidate =
        document === "DO_NOT_RESURFACE" && conflict.database
          ? candidateIndex.get(conflict.key) ?? null
          : null;
      const existing = await tx.markdownSyncConflict.findFirst({
        where: {
          syncStateId: currentState.id,
          normalizedIdentity: conflict.key,
          status: "OPEN",
        },
      });
      const snapshots = {
        databaseSnapshot: {
          kind: conflict.kind,
          entry: conflict.database,
          candidateId: databaseCandidate?.id ?? null,
          candidateVersion: databaseCandidate?.version ?? null,
        } as Prisma.InputJsonValue,
        markdownSnapshot: {
          kind: conflict.kind,
          deleted: conflict.markdown === null,
          entry: conflict.markdown,
        } as Prisma.InputJsonValue,
      };
      if (existing) {
        await tx.markdownSyncConflict.update({
          where: { id: existing.id },
          data: { ...snapshots, version: { increment: 1 } },
        });
      } else {
        await tx.markdownSyncConflict.create({
          data: {
            syncStateId: currentState.id,
            normalizedIdentity: conflict.key,
            ...snapshots,
          },
        });
      }
    }
    const afterImport = { ...currentDatabase };
    for (const imported of reconciliation.imports) {
      afterImport[imported.key] = imported.entry;
    }
    const updated = await tx.markdownSyncState.updateMany({
      where: { id: currentState.id, version: currentState.version },
      data: {
        baseSnapshot: reconciliation.nextBase as Prisma.InputJsonValue,
        lastImportedRepositoryRevision: repository.revision,
        lastImportedAt: new Date(),
        lastRepositoryHash: hashText(repository.content),
        lastDatabaseHash: hashSnapshot(afterImport),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new SyncStateVersionError();
  });
  return {
    document,
    repositoryRevision: repository.revision,
    importedCount: reconciliation.imports.length,
    conflictCount: reconciliation.conflicts.length,
  };
}

function renderSnapshot(
  document: MarkdownDocumentKind,
  snapshot: SyncSnapshot,
): string {
  if (document === "TASTE_LOG") {
    return renderTasteLog(
      Object.values(snapshot).map((entry) => ({
        weekOf: entryString(entry, "weekOf"),
        note: entryString(entry, "note"),
      })),
    );
  }
  return renderDoNotResurface(
    Object.entries(snapshot).map(([normalizedIdentity, entry]) => ({
      normalizedIdentity,
      name: entryString(entry, "name"),
      project: entry.project,
      status: entryString(entry, "status") as DoNotResurfaceRow["status"],
      date: entry.date,
      note: entry.note,
    })),
  );
}

export async function exportRepositoryDocument(
  database: PrismaClient,
  provider: RepositoryProvider,
  workspaceId: string,
  document: MarkdownDocumentKind,
) {
  const state = await database.markdownSyncState.findUnique({
    where: { workspaceId_document: { workspaceId, document } },
  });
  if (!state) throw new RepositoryChangedError();
  const openConflicts = state
    ? await database.markdownSyncConflict.count({
        where: { syncStateId: state.id, status: "OPEN" },
      })
    : 0;
  if (openConflicts > 0) throw new SyncConflictsPendingError();

  const currentRepository = await provider.read(DOCUMENT_PATHS[document]);
  if (
    state?.lastImportedRepositoryRevision &&
    currentRepository.revision !== state.lastImportedRepositoryRevision
  ) {
    throw new RepositoryChangedError();
  }
  const snapshot = await databaseSnapshot(database, workspaceId, document);
  const content = renderSnapshot(document, snapshot);
  const written = await provider.write({
    path: DOCUMENT_PATHS[document],
    content,
    expectedRevision: currentRepository.revision,
    message: `chore(rolodex): sync ${document.toLowerCase().replaceAll("_", "-")}`,
  });
  const databaseRevision = (state.lastExportedDatabaseRevision ?? 0) + 1;
  const updated = await database.markdownSyncState.updateMany({
    where: { id: state.id, version: state.version },
    data: {
      baseSnapshot: snapshot as Prisma.InputJsonValue,
      lastImportedRepositoryRevision: written.revision,
      lastImportedAt: new Date(),
      lastExportedDatabaseRevision: databaseRevision,
      lastExportedAt: new Date(),
      lastDatabaseHash: hashSnapshot(snapshot),
      lastRepositoryHash: hashText(content),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new SyncStateVersionError();
  return {
    document,
    repositoryRevision: written.revision,
    databaseRevision,
    contentHash: hashText(content),
  };
}

export async function reconcileRepository(
  database: PrismaClient,
  provider: RepositoryProvider,
  principal: Pick<AuthenticatedPrincipal, "workspaceId" | "userId">,
  documents: MarkdownDocumentKind[],
) {
  const results = [];
  for (const document of documents) {
    const imported = await importRepositoryDocument(
      database,
      provider,
      principal,
      document,
    );
    if (imported.conflictCount > 0) {
      results.push({ ...imported, exported: false });
      continue;
    }
    const exported = await exportRepositoryDocument(
      database,
      provider,
      principal.workspaceId,
      document,
    );
    results.push({ ...imported, exported: true, ...exported });
  }
  return results;
}

export async function listSyncConflicts(
  database: PrismaClient,
  workspaceId: string,
) {
  return database.markdownSyncConflict.findMany({
    where: { syncState: { workspaceId }, status: "OPEN" },
    include: { syncState: { select: { document: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
