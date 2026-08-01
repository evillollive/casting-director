/*
 * memory.js: the parts of the weekly loop that have to survive between runs.
 *
 * The rolodex is only half of the skill's memory. TUNING (this week's beat and
 * hard nos) and the taste log are the other half, and in a paste-the-prompt
 * workflow they are the first things to get lost. Both live in localStorage
 * only, and both export markdown that matches the repo's files.
 */
(function (root) {
  "use strict";

  const TUNING_KEY = "casting-director.tuning.v1";
  const TASTE_KEY = "casting-director.tastelog.v1";
  // How many taste-log lines to carry into a run. Enough to teach an eye,
  // short enough not to bury the prompt.
  const TASTE_INJECT_LIMIT = 8;

  const TUNING_FIELDS = [
    { key: "beat", label: "Beat / theme focus right now" },
    { key: "hardNos", label: "Hard nos" },
    { key: "moreOf", label: "More of" },
  ];

  function _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const data = JSON.parse(raw);
      return data === null || data === undefined ? fallback : data;
    } catch (_) {
      return fallback;
    }
  }

  const Tuning = {
    FIELDS: TUNING_FIELDS,
    load() {
      const data = _read(TUNING_KEY, {});
      const out = {};
      for (const f of TUNING_FIELDS) out[f.key] = String(data[f.key] || "");
      return out;
    },
    save(values) {
      const out = {};
      for (const f of TUNING_FIELDS) out[f.key] = String((values && values[f.key]) || "").trim();
      localStorage.setItem(TUNING_KEY, JSON.stringify(out));
    },
    // Replace the placeholder text after each TUNING label, leaving any label
    // the user has not filled in exactly as the canonical prompt wrote it.
    inject(template, values) {
      let out = template;
      for (const f of TUNING_FIELDS) {
        const value = String((values && values[f.key]) || "").trim();
        if (!value) continue;
        const label = f.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(
          new RegExp("^- \\*\\*" + label + ":\\*\\*.*$", "m"),
          "- **" + f.label + ":** " + value
        );
      }
      return out;
    },
  };

  const TasteLog = {
    load() {
      const data = _read(TASTE_KEY, []);
      return Array.isArray(data) ? data.map(TasteLog.normalize) : [];
    },
    save(entries) {
      localStorage.setItem(TASTE_KEY, JSON.stringify((entries || []).map(TasteLog.normalize)));
    },
    normalize(e) {
      return {
        week: String((e && e.week) || "").trim(),
        note: String((e && e.note) || "").trim().replace(/\s*\n\s*/g, " "),
      };
    },
    add(week, note) {
      const entries = TasteLog.load();
      entries.unshift(TasteLog.normalize({ week, note }));
      TasteLog.save(entries);
      return entries;
    },
    lines(entries) {
      return (entries || [])
        .filter((e) => e.note)
        .map((e) => "- _Week of " + (e.week || "____") + ":_ " + e.note);
    },
    toMarkdown(entries) {
      const body = TasteLog.lines(entries);
      return [
        "# Taste log",
        "",
        "One line per week: which briefs you loved, which you cut, and why.",
        "",
        "",
      ].join("\n") + (body.length ? body.join("\n") : "- _Week of ____:_") + "\n";
    },
    // Carry recent lines into the prompt's TASTE LOG block, so a fresh chat
    // starts with the eye the previous runs taught it.
    inject(template, entries) {
      const body = TasteLog.lines(entries).slice(0, TASTE_INJECT_LIMIT);
      if (!body.length) return template;
      return template.replace(/^- _Week of ____:_$/m, body.join("\n"));
    },
  };

  root.Tuning = Tuning;
  root.TasteLog = TasteLog;
})(typeof window !== "undefined" ? window : globalThis);
