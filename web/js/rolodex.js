/*
 * rolodex.js: local, private do-not-resurface storage for the browser app.
 *
 * Entries live in localStorage only. The markdown it emits is drop-in
 * compatible with rolodex/do-not-resurface.md in the repo, so the Tier 0
 * workflow and this app share one format.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "casting-director.rolodex.v1";
  const COLUMNS = ["name", "project", "status", "date", "note"];
  const HEADER = "| Name / handle | Project | Status (surfaced / contacted / cast / passed) | Date | Note |";
  const SEPARATOR = "|---------------|---------|-----------------------------------------------|------|------|";

  const DOC_INTRO = [
    "# Do-not-resurface",
    "",
    "The canonical list of people already surfaced, contacted, cast, or deliberately passed on. Anyone here is excluded from every scan. Keep it short and scannable, one row per person or project.",
    "",
  ];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.map(normalize) : [];
    } catch (_) {
      return [];
    }
  }

  function save(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.map(normalize)));
  }

  function normalize(e) {
    const out = {};
    for (const c of COLUMNS) out[c] = (e && e[c] != null ? String(e[c]) : "").trim();
    return out;
  }

  function escapeCell(s) {
    return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  }

  // Just the table (header + separator + rows). Used for prompt injection and
  // for feeding CastingEval.parseDnrNames.
  function toTable(entries) {
    const rows = (entries || []).filter((e) => e.name || e.project);
    const lines = [HEADER, SEPARATOR];
    for (const e of rows) {
      lines.push(
        "| " + [e.name, e.project, e.status, e.date, e.note].map(escapeCell).join(" | ") + " |"
      );
    }
    return lines.join("\n");
  }

  // A full document, drop-in compatible with rolodex/do-not-resurface.md.
  function toMarkdown(entries) {
    return DOC_INTRO.join("\n") + toTable(entries) + "\n";
  }

  function fromMarkdown(text) {
    const entries = [];
    for (let line of String(text).split(/\r?\n/)) {
      line = line.trim();
      if (!line.startsWith("|")) continue;
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.length < 2) continue;
      const first = cells[0].toLowerCase();
      if (first === "name / handle" || first === "name/handle" || first === "") continue;
      if (first.length && [...first].every((ch) => ch === "-" || ch === ":")) continue;
      const joined = cells.slice(0, 2).join(" ").toLowerCase();
      if (joined.includes("example") || (joined.includes("_") && !cells[0])) continue;
      // strip italic/underscore emphasis used by the template example row
      const clean = (s) => String(s || "").replace(/^[_*]+|[_*]+$/g, "").trim();
      const name = clean(cells[0]);
      const project = clean(cells[1]);
      if (!name && !project) continue;
      if (/^example/i.test(name) || /^example/i.test(project)) continue;
      entries.push(normalize({
        name, project,
        status: clean(cells[2] || ""),
        date: clean(cells[3] || ""),
        note: clean(cells[4] || ""),
      }));
    }
    return entries;
  }

  root.Rolodex = { COLUMNS, load, save, normalize, toTable, toMarkdown, fromMarkdown };
})(typeof window !== "undefined" ? window : globalThis);
