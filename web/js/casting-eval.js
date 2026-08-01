/*
 * casting-eval.js: a faithful browser/node port of tools/casting_eval.py.
 *
 * It lints a casting-director run output against the skill's hard rules, the
 * same rules the prompt and rubric.md define. This is the deterministic,
 * no-AI, no-network half of the skill, so it runs entirely in the browser.
 *
 * Parity with the Python evaluator is enforced by tests/test_web_eval_parity.py.
 * When you change one, change the other and keep the fixtures green.
 */
(function (root) {
  "use strict";

  const ERROR = "error";
  const WARN = "warn";

  const REQUIRED_FIELDS = [
    "name", "project", "hook", "why_now", "voice", "arc", "reach", "score", "source",
  ];

  // Map a field key to the substrings that can introduce it in the bold label.
  // Object key order mirrors the Python dict, which _labelToKey relies on.
  const FIELD_LABELS = {
    name: ["name / handle", "name/handle", "name"],
    project: ["project"],
    hook: ["the hook", "hook"],
    why_now: ["why now"],
    voice: ["voice"],
    arc: ["arc"],
    reach: ["reach"],
    caveat: ["caveat"],
    score: ["score"],
    source: ["source link", "source"],
  };

  const URL_RE = /https?:\/\/[^\s)>\]]+/g;
  const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
  const OVERALL_RE = /\b([0-5])\s*\/\s*5\b/;
  const DIMS = ["p", "hook", "now", "voice", "arc", "reach"];

  const REFUSAL_SIGNALS = [
    "stopping rather than",
    "won't fabricate",
    "will not fabricate",
    "not fabricate",
    "re-run with browsing",
    "rerun with browsing",
  ];

  // A refusal states that web/browsing access is missing. Strong negations may
  // sit a few connector words away from the access noun.
  const _NEG = "(?:don'?t have|do not have|without|lack|unable to|can'?t|cannot|no)";
  const _GAP = "(?:\\s+(?:to|a|the|any|reach|access|use|get|got|connect|browse|load|open|find))*";
  const _ACCESS = "\\s+(?:working\\s+|live\\s+)?(?:web access|web|internet|browsing|browser|search)\\b";
  const REFUSAL_RE = new RegExp(_NEG + _GAP + _ACCESS, "i");

  const CORPORATE_SIGNALS = [
    "series a", "series b", "series c", "raised $", "venture", "vc-backed",
    "vc backed", "backed by", "seed round", "funding round", "our company",
    ", inc.", " inc.", " gmbh",
  ];

  const DIVERSITY_ACK = [
    "cluster", "all from", "same source", "monotone", "lean", "spread", "skew", "swap",
  ];

  const FIELD_LINE_RE = /^\s*[-*]\s*\*\*([^*]+?):?\*\*\s*(.*)$/;
  const SECTION_HEADER_RE = /^\s*#{1,6}\s/;

  function violation(code, severity, message, entry) {
    return { code, severity, message, entry: entry || null };
  }

  function _labelToKey(label) {
    const low = label.trim().toLowerCase();
    for (const key of Object.keys(FIELD_LABELS)) {
      for (const s of FIELD_LABELS[key]) {
        if (low.startsWith(s)) return key;
      }
    }
    return null;
  }

  function parseEntries(text) {
    const lines = text.split(/\r?\n/);
    const entries = [];
    let current = null;
    for (const line of lines) {
      const m = FIELD_LINE_RE.exec(line);
      if (!m) {
        if (current !== null && SECTION_HEADER_RE.test(line)) {
          entries.push(current);
          current = null;
        }
        continue;
      }
      const key = _labelToKey(m[1]);
      const value = m[2].trim();
      if (key === "name") {
        if (current !== null) entries.push(current);
        current = { name: value, fields: { name: value }, raw: line + "\n" };
      } else if (current !== null && key !== null) {
        current.fields[key] = value;
        current.raw += line + "\n";
      }
    }
    if (current !== null) entries.push(current);
    return entries;
  }

  function entryGet(entry, key) {
    return entry.fields[key] || "";
  }

  function parseDnrNames(dnrText) {
    const names = [];
    for (let line of dnrText.split(/\r?\n/)) {
      line = line.trim();
      if (!line.startsWith("|")) continue;
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.length < 2) continue;
      const first = cells[0].toLowerCase();
      if (first === "name / handle" || first === "name/handle" || first === "") continue;
      if (first.length && [...first].every((ch) => ch === "-" || ch === ":")) continue;
      const joined = cells.slice(0, 2).join(" ").toLowerCase();
      if (joined.includes("example") || joined.includes("_")) continue;
      for (let c of cells.slice(0, 2)) {
        c = c.trim().replace(/^[_*]+|[_*]+$/g, "");
        if (c) names.push(c.toLowerCase());
      }
    }
    return names;
  }

  function _domain(url) {
    const m = /^https?:\/\/([^/]+)\/?/.exec(url);
    return m ? m[1].toLowerCase().replace("www.", "") : url.toLowerCase();
  }

  function isRefusal(text) {
    const low = text.toLowerCase();
    if (REFUSAL_SIGNALS.some((sig) => low.includes(sig))) return true;
    return REFUSAL_RE.test(text);
  }

  function parseScoreTuple(scoreText) {
    const out = {};
    const mo = OVERALL_RE.exec(scoreText);
    if (mo) out.overall = parseInt(mo[1], 10);
    for (const dim of DIMS) {
      const re = new RegExp("\\b" + dim + "\\s*[:=]?\\s*([1-5])\\b", "i");
      const m = re.exec(scoreText);
      if (m) out[dim] = parseInt(m[1], 10);
    }
    return out;
  }

  function _shortlistCheckText(text) {
    const m = /#+\s*Shortlist check\b([\s\S]*)$/i.exec(text);
    return m ? m[1].toLowerCase() : "";
  }

  function findAll(re, text) {
    // re must be global. Returns array of full matches.
    const out = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      out.push(m[0]);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  function evaluate(text, dnrNames, live) {
    dnrNames = dnrNames || [];
    const violations = [];
    const entries = parseEntries(text);

    if (isRefusal(text)) {
      if (entries.length) {
        violations.push(violation(
          "REFUSAL_WITH_CANDIDATES", ERROR,
          "Output refuses (no web access) yet still lists candidates. A refusal must contain zero candidates."
        ));
      }
      return violations;
    }

    if (!entries.length) {
      violations.push(violation("NO_ENTRIES", ERROR, "No shortlist entries found and this is not a refusal."));
      return violations;
    }

    const n = entries.length;
    if (n > 8) {
      violations.push(violation("SHORTLIST_SIZE", ERROR, `Shortlist has ${n} entries; the cap is 8.`));
    } else if (n < 5 && !/quiet week|thin week|fewer than|only \w+ credible/i.test(text)) {
      violations.push(violation("SHORTLIST_SIZE", WARN, `Shortlist has ${n} entries (<5) with no 'quiet week' justification.`));
    }

    const domains = [];
    for (const e of entries) {
      const label = e.name || "(unnamed)";
      for (const fkey of REQUIRED_FIELDS) {
        if (!entryGet(e, fkey).trim()) {
          violations.push(violation("MISSING_FIELD", ERROR, `Missing required field '${fkey}'.`, label));
        }
      }

      const srcUrls = findAll(URL_RE, entryGet(e, "source"));
      if (!srcUrls.length) {
        violations.push(violation("NO_SOURCE_URL", ERROR, "No source URL. Every candidate needs a live link opened this run.", label));
      }
      if (srcUrls.length) domains.push(_domain(srcUrls[0]));

      const why = entryGet(e, "why_now").toLowerCase();
      if (why && !(ISO_DATE_RE.test(entryGet(e, "why_now")) || why.includes("evergreen"))) {
        violations.push(violation("UNDATED_WHY_NOW", ERROR, "'Why now' has no date and is not labeled evergreen.", label));
      }

      const scores = parseScoreTuple(entryGet(e, "score"));
      if (!("overall" in scores)) {
        violations.push(violation("BAD_SCORE", ERROR, "Score is missing an overall X/5.", label));
      }
      const missingDims = DIMS.filter((d) => !(d in scores));
      if (missingDims.length) {
        violations.push(violation("BAD_SCORE_TUPLE", ERROR, `Score tuple missing dimensions: ${missingDims.join(", ")}.`, label));
      } else {
        if (scores.p < 3) {
          violations.push(violation("GATE_PROTAGONIST", ERROR, `Shortlisted with Protagonist=${scores.p} (<3 fails the gate).`, label));
        }
        if (scores.hook < 3) {
          violations.push(violation("GATE_HOOK", ERROR, `Shortlisted with Visible hook=${scores.hook} (<3 fails the gate).`, label));
        }
      }

      const hay = `${entryGet(e, "name")} ${entryGet(e, "project")}`.toLowerCase();
      for (const bad of dnrNames) {
        if (bad && hay.includes(bad)) {
          violations.push(violation("RESURFACED", ERROR, `Matches do-not-resurface entry '${bad}'.`, label));
        }
      }

      const blob = e.raw.toLowerCase();
      const caveat = entryGet(e, "caveat").toLowerCase();
      const hit = CORPORATE_SIGNALS.find((s) => blob.includes(s));
      if (hit && !caveat.includes(hit) && !caveat.includes("corporate") && !caveat.includes("vc") && !caveat.includes("funded")) {
        violations.push(violation("CORPORATE_FALSE_POSITIVE", WARN, `Looks funded/corporate ('${hit.trim()}') with no caveat.`, label));
      }
    }

    const nonEmpty = domains.filter((d) => d);
    const uniq = new Set(nonEmpty);
    if (nonEmpty.length >= 3 && uniq.size === 1) {
      const checkText = _shortlistCheckText(text);
      if (!DIVERSITY_ACK.some((w) => checkText.includes(w))) {
        violations.push(violation(
          "MONOTONE_SHORTLIST", WARN,
          `All ${nonEmpty.length} entries share one source (${uniq.values().next().value}) and the shortlist check doesn't flag it.`
        ));
      }
    }

    // Live URL resolution (the Python --live path) is intentionally omitted in
    // the browser: a static page cannot HEAD arbitrary cross-origin URLs.
    return violations;
  }

  function hasErrors(violations) {
    return violations.some((v) => v.severity === ERROR);
  }

  function formatReport(violations) {
    if (!violations.length) return "PASS: no violations.";
    const lines = [];
    for (const v of violations) {
      const loc = v.entry ? ` [${v.entry}]` : "";
      lines.push(`${v.severity.toUpperCase().padEnd(5)} ${v.code}${loc}: ${v.message}`);
    }
    const errs = violations.filter((v) => v.severity === ERROR).length;
    const warns = violations.filter((v) => v.severity === WARN).length;
    lines.push(`\n${errs} error(s), ${warns} warning(s).`);
    return lines.join("\n");
  }

  const api = {
    ERROR, WARN, REQUIRED_FIELDS,
    parseEntries, parseDnrNames, parseScoreTuple, isRefusal,
    evaluate, hasErrors, formatReport,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CastingEval = api;
})(typeof window !== "undefined" ? window : globalThis);
