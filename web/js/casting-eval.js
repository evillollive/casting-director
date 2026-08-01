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
    sensitivity: ["sensitivity"],
    score: ["score"],
    source: ["source link", "source"],
  };

  const URL_RE = /https?:\/\/[^\s)>\]]+/g;
  const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
  const ISO_DATE_RE_G = /\b\d{4}-\d{2}-\d{2}\b/g;
  // "4.5/5" must not read as an overall of 5, so refuse a preceding digit or dot.
  const OVERALL_RE = /(?:^|[^\d.])([0-5])\s*\/\s*5\b/;
  const DIMS = ["p", "hook", "now", "voice", "arc", "reach"];

  // How far past the ~7 day window a dated "why now" can sit before it stops
  // being a reason to tell the story *this* week.
  const STALE_DAYS = 14;

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

  // Acknowledging a cluster means naming it. Generic praise ("good spread across
  // sources") is exactly the boilerplate the check exists to catch, so only words
  // that admit clustering count, plus naming the clustered source itself.
  const DIVERSITY_ACK = [
    "cluster", "all from", "same source", "monotone", "skew", "swap", "over-index",
  ];

  // A source URL's host tells you where the candidate was found. A repo host does
  // not: almost every candidate links a repo, so counting raw domains would call
  // any list "varied". These are folded into feeds, and repo hosts are generic.
  const FEEDS = {
    "news.ycombinator.com": "Hacker News",
    "hn.algolia.com": "Hacker News",
    "reddit.com": "Reddit",
    "redd.it": "Reddit",
    "producthunt.com": "Product Hunt",
    "lobste.rs": "Lobsters",
    "dev.to": "Dev.to",
    "indiehackers.com": "Indie Hackers",
    "hackaday.com": "Hackaday",
    "hackaday.io": "Hackaday",
    "itch.io": "itch.io",
    "devpost.com": "Devpost",
    "kickstarter.com": "Kickstarter",
    "tindie.com": "Tindie",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "twitch.tv": "Twitch",
    "bsky.app": "Bluesky",
    "mastodon.social": "Mastodon",
    "fosstodon.org": "Mastodon",
    "x.com": "X",
    "twitter.com": "X",
    "github.com": "GitHub",
    "gist.github.com": "GitHub",
    "github.blog": "GitHub",
    "gitlab.com": "GitLab",
    "codeberg.org": "Codeberg",
    "sourcehut.org": "sourcehut",
  };
  // Code hosts: where the work lives, not where you found the person.
  const GENERIC_FEEDS = ["GitHub", "GitLab", "Codeberg", "sourcehut"];
  // The rubric flags a cluster at three or more entries from one source.
  const CLUSTER_MIN = 3;

  // Surfacing a minor is a different decision from surfacing an adult, so it has
  // to be named in the brief rather than discovered during outreach.
  const MINOR_RE = new RegExp(
    "\\b(?:1[0-7]\\s*[- ]?\\s*year[- ]?old|high[- ]school(?:er)?|teenager|teenage|" +
    "under\\s*18|underage|schoolkid|middle[- ]school)\\b",
    "i"
  );
  const MINOR_ACK = ["minor", "age", "guardian", "parent", "consent", "under 18", "school"];

  // Contact paths must be public and non-invasive.
  const INVASIVE_SIGNALS = [
    "phone number", "home address", "personal phone", "cell number",
    "mobile number", "employer email", "work email", "home email",
    "family member", "school address",
  ];
  const PHONE_RE = /(?:^|[^\w])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)\s*|\d{2,4}[\s.-])\d{2,4}[\s.-]?\d{2,4}(?!\w)/;

  // Field bullets look like: - **Label:** value
  const FIELD_LINE_RE = /^\s*[-*]\s*\*\*([^*]+?):?\*\*\s*(.*)$/;
  const HEADER_RE = /^\s*#{1,6}\s/;
  const PARKING_HEADER_RE = /^\s*#{1,6}\s*parking\b/i;
  // "Shortlist check" is a report section, not more candidates, so it must be
  // tested before the plain "Shortlist" header.
  const CHECK_HEADER_RE = /^\s*#{1,6}\s*(?:shortlist check|list check|notes|taste log|tuning)\b/i;
  const SHORTLIST_HEADER_RE = /^\s*#{1,6}\s*shortlist\b/i;

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

  /* Split a run into 'shortlist', 'parking' and 'other' line groups.
   *
   * Without this, a parking lot written with the same bold-label template parses
   * as extra shortlist entries: false missing-field errors and a false size
   * violation for names that were never shortlisted. */
  function splitSections(text) {
    const out = { shortlist: [], parking: [], other: [] };
    let section = "shortlist";
    for (const line of text.split(/\r?\n/)) {
      if (HEADER_RE.test(line)) {
        if (PARKING_HEADER_RE.test(line)) section = "parking";
        else if (CHECK_HEADER_RE.test(line)) section = "other";
        else if (SHORTLIST_HEADER_RE.test(line)) section = "shortlist";
      }
      out[section].push(line);
    }
    return out;
  }

  function _parseEntryLines(lines) {
    const entries = [];
    let current = null;
    for (const line of lines) {
      const m = FIELD_LINE_RE.exec(line);
      if (!m) {
        if (current !== null && HEADER_RE.test(line)) {
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

  function parseEntries(text) {
    return _parseEntryLines(splitSections(text).shortlist);
  }

  /* The prose of a run, with candidate field bullets removed. Refusal detection
   * reads this rather than the raw text: a brief for an offline-first project
   * ("works without internet access") otherwise trips the refusal regex and
   * voids the entire run. */
  function narrativeText(text) {
    return text.split(/\r?\n/).filter((line) => !FIELD_LINE_RE.test(line)).join("\n");
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

  /* Reduce a rolodex cell to a comparable token. '@octocat',
   * 'https://github.com/octocat' and 'octocat' are the same person, and the
   * table is hand-typed, so whitespace is collapsed too. */
  function normalizeDnrName(name) {
    let n = String(name || "").trim().toLowerCase();
    n = n.replace(/^https?:\/\//, "");
    n = n.replace(/^(?:www\.)?(?:github|gitlab|codeberg)\.com\//, "");
    n = n.replace(/^@+/, "").trim().replace(/^\/+|\/+$/g, "");
    return n.replace(/\s+/g, " ");
  }

  function _boundedIncludes(hay, needle) {
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      const before = idx > 0 ? hay[idx - 1] : "";
      const after = idx + needle.length < hay.length ? hay[idx + needle.length] : "";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
      idx = hay.indexOf(needle, idx + 1);
    }
    return false;
  }

  /* Which do-not-resurface entries genuinely appear in this text. Matching is
   * bounded, not substring: a rolodex entry for 'ai' must not veto 'Aisha', and
   * very short tokens are ignored because they cannot be identifying. */
  function dnrMatches(haystack, dnrNames) {
    const hay = String(haystack || "").toLowerCase().replace(/\s+/g, " ");
    const hits = [];
    for (const raw of dnrNames || []) {
      const needle = normalizeDnrName(raw);
      if (needle.length < 3) continue;
      if (_boundedIncludes(hay, needle)) hits.push(raw);
    }
    return hits;
  }

  function _domain(url) {
    const m = /^https?:\/\/([^/]+)\/?/.exec(url);
    return m ? m[1].toLowerCase().replace("www.", "") : url.toLowerCase();
  }

  function _feed(url) {
    const domain = _domain(url);
    for (const host of Object.keys(FEEDS)) {
      if (domain === host || domain.endsWith("." + host)) return FEEDS[host];
    }
    return domain;
  }

  /* The feed an entry was sourced from: the first non-repo host if there is one,
   * since a repo link says where the code lives, not where you found them. */
  function entryFeed(urls) {
    const feeds = urls.map(_feed);
    for (const f of feeds) {
      if (GENERIC_FEEDS.indexOf(f) === -1) return f;
    }
    return feeds.length ? feeds[0] : null;
  }

  function isoDates(value) {
    const out = [];
    for (const raw of findAll(ISO_DATE_RE_G, String(value || ""))) {
      const parts = raw.split("-").map((x) => parseInt(x, 10));
      const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      if (
        d.getUTCFullYear() === parts[0] &&
        d.getUTCMonth() === parts[1] - 1 &&
        d.getUTCDate() === parts[2]
      ) {
        out.push(d);
      }
    }
    return out;
  }

  function _coerceDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) return value;
    const dates = isoDates(String(value));
    return dates.length ? dates[0] : null;
  }

  function _isoString(d) {
    return d.toISOString().slice(0, 10);
  }

  function isRefusal(text) {
    const narrative = narrativeText(text);
    const low = narrative.toLowerCase();
    if (REFUSAL_SIGNALS.some((sig) => low.includes(sig))) return true;
    return REFUSAL_RE.test(narrative);
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

  /* Lint a run. Pass options.asOf (a YYYY-MM-DD string) to also check recency. */
  function evaluate(text, dnrNames, live, options) {
    dnrNames = dnrNames || [];
    const asOf = _coerceDate(options && options.asOf);
    const violations = [];
    const sections = splitSections(text);
    const entries = _parseEntryLines(sections.shortlist);

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

    const seenNames = new Set();
    for (const e of entries) {
      const key = e.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (key && seenNames.has(key)) {
        violations.push(violation("DUPLICATE_ENTRY", ERROR, "This candidate appears more than once in the shortlist.", e.name));
      }
      seenNames.add(key);
    }

    const feeds = [];
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
      const feed = entryFeed(srcUrls);
      if (feed) feeds.push(feed);

      const why = entryGet(e, "why_now").toLowerCase();
      if (why && !(ISO_DATE_RE.test(entryGet(e, "why_now")) || why.includes("evergreen"))) {
        violations.push(violation("UNDATED_WHY_NOW", ERROR, "'Why now' has no date and is not labeled evergreen.", label));
      }
      if (asOf !== null) {
        const dates = isoDates(entryGet(e, "why_now"));
        if (dates.length) {
          const newest = new Date(Math.max.apply(null, dates.map((d) => d.getTime())));
          const cutoff = new Date(asOf.getTime() - STALE_DAYS * 86400000);
          if (newest.getTime() > asOf.getTime()) {
            violations.push(violation("FUTURE_WHY_NOW", WARN, `'Why now' is dated ${_isoString(newest)}, after the run date.`, label));
          } else if (newest.getTime() < cutoff.getTime()) {
            violations.push(violation(
              "STALE_WHY_NOW", WARN,
              `'Why now' is dated ${_isoString(newest)}, outside the ~7 day window. It is a reason, but not a reason this week.`,
              label
            ));
          }
        }
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

      const hay = `${entryGet(e, "name")} ${entryGet(e, "project")}`;
      for (const bad of dnrMatches(hay, dnrNames)) {
        violations.push(violation("RESURFACED", ERROR, `Matches do-not-resurface entry '${bad}'.`, label));
      }

      const blob = e.raw.toLowerCase();
      const caveat = `${entryGet(e, "caveat")} ${entryGet(e, "sensitivity")}`.toLowerCase();
      const hit = CORPORATE_SIGNALS.find((s) => blob.includes(s));
      if (hit && !caveat.includes(hit) && !caveat.includes("corporate") && !caveat.includes("vc") && !caveat.includes("funded")) {
        violations.push(violation("CORPORATE_FALSE_POSITIVE", WARN, `Looks funded/corporate ('${hit.trim()}') with no caveat.`, label));
      }

      if (MINOR_RE.test(e.raw) && !MINOR_ACK.some((a) => caveat.includes(a))) {
        violations.push(violation(
          "MINOR_SUBJECT", WARN,
          "Reads as a minor with no caveat. Filming a minor needs a guardian, so say so in the brief.",
          label
        ));
      }
      const reachProse = entryGet(e, "reach").replace(URL_RE, " ").replace(ISO_DATE_RE_G, " ");
      const invasive = INVASIVE_SIGNALS.find((s) => reachProse.toLowerCase().includes(s));
      if (invasive || PHONE_RE.test(reachProse)) {
        violations.push(violation(
          "INVASIVE_CONTACT", WARN,
          `Contact path looks invasive (${invasive || "a phone number"}). Use public, non-invasive paths only.`,
          label
        ));
      }
    }

    // Diversity: a clustered shortlist must be acknowledged in the check line.
    if (feeds.length) {
      const counts = {};
      for (const f of feeds) counts[f] = (counts[f] || 0) + 1;
      let top = null;
      for (const k of Object.keys(counts)) {
        if (top === null || counts[k] > counts[top] || (counts[k] === counts[top] && k > top)) top = k;
      }
      if (counts[top] >= CLUSTER_MIN) {
        const check = _shortlistCheckText(text);
        if (!(DIVERSITY_ACK.some((w) => check.includes(w)) || check.includes(top.toLowerCase()))) {
          violations.push(violation(
            "MONOTONE_SHORTLIST", WARN,
            `${counts[top]} of ${entries.length} entries come from one source (${top}) and the shortlist check doesn't flag it.`
          ));
        }
      }
    }

    // The do-not-resurface list is an exclusion, so parking someone still breaks it.
    const parking = sections.parking.join("\n");
    for (const bad of dnrMatches(parking, dnrNames)) {
      violations.push(violation("RESURFACED_PARKING", WARN, `Parking lot names do-not-resurface entry '${bad}'.`));
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
    parseEntries, splitSections, narrativeText, parseDnrNames, dnrMatches,
    normalizeDnrName, parseScoreTuple, isRefusal, entryFeed,
    evaluate, hasErrors, formatReport,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CastingEval = api;
})(typeof window !== "undefined" ? window : globalThis);
