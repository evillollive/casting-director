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

export function normalizeDnrIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(?:www\.)?(?:github|gitlab|codeberg)\.com\//, "")
    .replace(/^@+/, "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, " ");
}

export function parseDoNotResurface(markdown: string): DoNotResurfaceRow[] {
  const rows: DoNotResurfaceRow[] = [];

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

    const normalizedIdentity = normalizeDnrIdentity(name || project);
    if (normalizedIdentity.length < 3) continue;
    const rawDate = cleanCell(cells[3] ?? "");
    rows.push({
      name,
      project: project || null,
      status: importStatus(cells[2] ?? ""),
      date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
      note: cleanCell(cells[4] ?? "") || null,
      normalizedIdentity,
    });
  }

  return rows;
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
