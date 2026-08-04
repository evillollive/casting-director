import { hashSnapshot } from "@/server/scan/snapshots";

export type SyncEntry = Record<string, string | null>;
export type SyncSnapshot = Record<string, SyncEntry>;

export type ReconcileConflict = {
  key: string;
  kind: "DUAL_CHANGE" | "MARKDOWN_REMOVAL";
  database: SyncEntry | null;
  markdown: SyncEntry | null;
};

export type ReconcileResult = {
  imports: Array<{ key: string; entry: SyncEntry }>;
  conflicts: ReconcileConflict[];
  nextBase: SyncSnapshot;
};

function equal(left: SyncEntry | undefined, right: SyncEntry | undefined): boolean {
  return hashSnapshot(left ?? null) === hashSnapshot(right ?? null);
}

export function reconcileSnapshots(
  base: SyncSnapshot,
  database: SyncSnapshot,
  markdown: SyncSnapshot,
): ReconcileResult {
  const imports: ReconcileResult["imports"] = [];
  const conflicts: ReconcileConflict[] = [];
  const nextBase: SyncSnapshot = { ...base };
  const keys = [...new Set([
    ...Object.keys(base),
    ...Object.keys(database),
    ...Object.keys(markdown),
  ])].sort();

  for (const key of keys) {
    const baseEntry = base[key];
    const databaseEntry = database[key];
    const markdownEntry = markdown[key];
    const databaseChanged = !equal(baseEntry, databaseEntry);
    const markdownChanged = !equal(baseEntry, markdownEntry);

    if (baseEntry && !markdownEntry && databaseEntry) {
      conflicts.push({
        key,
        kind: "MARKDOWN_REMOVAL",
        database: databaseEntry,
        markdown: null,
      });
      continue;
    }
    if (databaseChanged && markdownChanged && !equal(databaseEntry, markdownEntry)) {
      conflicts.push({
        key,
        kind: "DUAL_CHANGE",
        database: databaseEntry ?? null,
        markdown: markdownEntry ?? null,
      });
      continue;
    }
    if (markdownChanged && markdownEntry) {
      imports.push({ key, entry: markdownEntry });
      nextBase[key] = markdownEntry;
      continue;
    }
    if (databaseChanged && markdownChanged && equal(databaseEntry, markdownEntry)) {
      if (databaseEntry) nextBase[key] = databaseEntry;
      else delete nextBase[key];
    }
  }
  return { imports, conflicts, nextBase };
}
