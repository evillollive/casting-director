import { spawnSync } from "node:child_process";

export type DoNotResurfaceRow = {
  name: string;
  project: string | null;
  status: "NEW" | "CONTACTED" | "PASSED" | "CAST" | "MAYBE_LATER";
  date: string | null;
  note: string | null;
  normalizedIdentity: string;
};

export type TasteLogRow = {
  weekOf: string;
  note: string;
};

const normalizationProgram = [
  "import json,sys",
  "from casting_eval import normalize_dnr_name",
  "values=json.load(sys.stdin)",
  "json.dump([normalize_dnr_name(value) for value in values],sys.stdout)",
].join(";");

function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;

  for (const character of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function cleanCell(value: string): string {
  return value.trim().replace(/^[_*]+|[_*]+$/g, "").trim();
}

function isSeparator(value: string): boolean {
  return /^:?-{3,}:?$/.test(value.trim());
}

function importStatus(value: string): DoNotResurfaceRow["status"] {
  const normalized = cleanCell(value).toLowerCase();
  if (normalized.includes("contacted")) return "CONTACTED";
  if (normalized.includes("passed")) return "PASSED";
  if (normalized.includes("cast")) return "CAST";
  if (normalized.includes("maybe") || normalized.includes("parked")) {
    return "MAYBE_LATER";
  }
  return "NEW";
}

export function normalizeDnrIdentities(values: string[]): string[] {
  if (values.length === 0) return [];
  const processResult = spawnSync(
    process.env.CASTING_PYTHON_BIN ?? "python3",
    ["-c", normalizationProgram],
    {
      encoding: "utf8",
      input: JSON.stringify(values),
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: ["tools", process.env.PYTHONPATH].filter(Boolean).join(":"),
      },
    },
  );
  if (processResult.status !== 0) {
    throw new Error(
      `Canonical DNR normalization failed: ${
        processResult.stderr || processResult.error?.message || "unknown error"
      }`,
    );
  }
  const output = JSON.parse(processResult.stdout) as unknown;
  if (
    !Array.isArray(output) ||
    output.length !== values.length ||
    output.some((value) => typeof value !== "string")
  ) {
    throw new Error("Canonical DNR normalization returned an invalid response.");
  }
  return output;
}

export function normalizeDnrIdentity(value: string): string {
  return normalizeDnrIdentities([value])[0] ?? "";
}

export function parseDoNotResurface(markdown: string): DoNotResurfaceRow[] {
  const parsed: Omit<DoNotResurfaceRow, "normalizedIdentity">[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length < 2) continue;

    const name = cleanCell(cells[0] ?? "");
    const project = cleanCell(cells[1] ?? "");
    const first = name.toLowerCase();
    if (
      !name ||
      first === "name / handle" ||
      first === "name/handle" ||
      isSeparator(name) ||
      `${name} ${project}`.toLowerCase().includes("example")
    ) {
      continue;
    }

    const rawDate = cleanCell(cells[3] ?? "");
    parsed.push({
      name,
      project: project || null,
      status: importStatus(cells[2] ?? ""),
      date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
      note: cleanCell(cells[4] ?? "") || null,
    });
  }

  const identities = normalizeDnrIdentities(
    parsed.map((row) => row.name || row.project || ""),
  );
  return parsed.flatMap((row, index) => {
    const normalizedIdentity = identities[index] ?? "";
    return normalizedIdentity.length < 3
      ? []
      : [{ ...row, normalizedIdentity }];
  });
}

const tasteLine =
  /^-\s+_?Week of\s+(\d{4}-\d{2}-\d{2}):_?\s*(.+?)\s*$/i;

export function parseTasteLog(markdown: string): TasteLogRow[] {
  return markdown
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.trim().match(tasteLine);
      if (!match) return [];
      const [, weekOf, note] = match;
      return weekOf && note ? [{ weekOf, note: note.trim() }] : [];
    });
}

function escapeCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function statusLabel(status: DoNotResurfaceRow["status"]): string {
  return status.toLowerCase().replace("_", "-");
}

export function renderDoNotResurface(rows: DoNotResurfaceRow[]): string {
  const sorted = [...rows].sort(
    (left, right) =>
      left.normalizedIdentity.localeCompare(right.normalizedIdentity) ||
      left.name.localeCompare(right.name),
  );
  return [
    "# Do-not-resurface",
    "",
    "The canonical list of people already surfaced, contacted, cast, or deliberately passed on. Anyone here is excluded from every scan. Keep it short and scannable, one row per person or project.",
    "",
    "**Tier 0 workflow:** before each run, copy this table into the DO-NOT-RESURFACE block of [`../prompts/tier0-weekly-scan.md`](../prompts/tier0-weekly-scan.md) so the pasted prompt can actually enforce it. (In Tier 1 a script reads this file directly as the dedupe \"seen\" set.)",
    "",
    "| Name / handle | Project | Status (surfaced / contacted / cast / passed) | Date | Note |",
    "|---------------|---------|-----------------------------------------------|------|------|",
    ...sorted.map(
      (row) =>
        `| ${escapeCell(row.name)} | ${escapeCell(row.project ?? "")} | ${statusLabel(row.status)} | ${row.date ?? ""} | ${escapeCell(row.note ?? "")} |`,
    ),
    "",
  ].join("\n");
}

export function renderTasteLog(rows: TasteLogRow[]): string {
  const sorted = [...rows].sort(
    (left, right) =>
      right.weekOf.localeCompare(left.weekOf) || left.note.localeCompare(right.note),
  );
  return [
    "# Taste log",
    "",
    "One line per week: which briefs you loved, which you cut, and why. This is how the rubric evolves. When a pattern shows up here repeatedly, fold it into [`../rubric.md`](../rubric.md) or the TUNING section of [`../prompts/tier0-weekly-scan.md`](../prompts/tier0-weekly-scan.md).",
    "",
    ...sorted.map(
      (row) =>
        `- _Week of ${row.weekOf}:_ ${row.note.replace(/\s+/g, " ").trim()}`,
    ),
    "",
  ].join("\n");
}
