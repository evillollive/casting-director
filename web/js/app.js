/*
 * app.js: wires the casting-director browser app together.
 *
 * Three surfaces, all keyless and offline:
 *   - Prep a run: build the weekly-scan prompt with the local rolodex injected.
 *   - Evaluate a run: lint a pasted shortlist with the ported casting_eval.
 *   - Rolodex: manage the do-not-resurface list in localStorage.
 * Reference renders the bundled canonical docs read-only.
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const CONTENT = "content/";
  let promptTemplate = null;

  /* ---------- version + status ---------- */
  const versionEl = $("#app-version");
  if (versionEl && window.__APP_VERSION__) versionEl.textContent = window.__APP_VERSION__;

  const statusEl = $("#status");
  function status(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "tab-status" + (kind ? " " + kind : "");
    if (msg) {
      clearTimeout(status._t);
      status._t = setTimeout(() => {
        statusEl.textContent = "";
        statusEl.className = "tab-status";
      }, 4000);
    }
  }

  async function fetchText(name) {
    const res = await fetch(CONTENT + name, { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load " + name + " (" + res.status + ")");
    return res.text();
  }

  /* ---------- tabs ---------- */
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = {
    prep: $("#panel-prep"),
    eval: $("#panel-eval"),
    rolodex: $("#panel-rolodex"),
    reference: $("#panel-reference"),
  };
  function keyFromTab(tab) { return tab.id.replace("tab-", ""); }

  function showTab(key) {
    for (const tab of tabs) {
      const isActive = keyFromTab(tab) === key;
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== key;
    if (key === "prep") refreshPrompt();
    if (key === "rolodex") renderRolodex();
    if (key === "reference") loadReference();
  }
  tabs.forEach((tab) => tab.addEventListener("click", () => showTab(keyFromTab(tab))));
  document.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) { e.preventDefault(); showTab(goto.getAttribute("data-goto")); }
  });

  /* ---------- prep a run ---------- */
  const promptPreview = $("#prompt-preview");
  const dnrNote = $("#dnr-injected-note");

  function injectDnr(template, table) {
    // Replace the "<!-- paste here -->" marker inside the DO-NOT-RESURFACE block.
    if (template.includes("<!-- paste here -->")) {
      return template.replace("<!-- paste here -->", table);
    }
    return template;
  }

  async function refreshPrompt() {
    try {
      if (promptTemplate === null) promptTemplate = await fetchText("tier0-weekly-scan.md");
    } catch (err) {
      promptPreview.value = "Could not load the prompt. If you are running this locally, serve the folder over http (see the README): " + err.message;
      return;
    }
    const entries = Rolodex.load();
    const table = Rolodex.toTable(entries);
    // Only re-inject if the user hasn't hand-edited the preview since last build.
    if (!promptPreview.dataset.dirty) {
      promptPreview.value = injectDnr(promptTemplate, table);
    }
    const count = entries.filter((e) => e.name || e.project).length;
    dnrNote.textContent = count
      ? count + " rolodex " + (count === 1 ? "entry" : "entries") + " injected."
      : "No rolodex entries yet; the DO-NOT-RESURFACE block is empty.";
  }

  promptPreview.addEventListener("input", () => { promptPreview.dataset.dirty = "1"; });

  $("#btn-copy-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(promptPreview.value);
      status("Prompt copied. Paste it into an assistant with web search on.", "ok");
    } catch (_) {
      promptPreview.select();
      status("Select-all done; press Cmd/Ctrl+C to copy.", "ok");
    }
  });

  $("#btn-download-prompt").addEventListener("click", () => {
    downloadText("casting-weekly-scan.md", promptPreview.value);
    status("Downloaded casting-weekly-scan.md", "ok");
  });

  /* ---------- evaluate a run ---------- */
  const runInput = $("#run-input");
  const reportEl = $("#report");

  $("#btn-evaluate").addEventListener("click", () => {
    const text = runInput.value.trim();
    if (!text) { status("Paste a run output first.", "err"); return; }
    const dnrNames = CastingEval.parseDnrNames(Rolodex.toTable(Rolodex.load()));
    const violations = CastingEval.evaluate(text, dnrNames, false);
    renderReport(violations);
    const errs = violations.filter((v) => v.severity === "error").length;
    status(errs ? errs + " error(s) found." : "Evaluation complete.", errs ? "err" : "ok");
  });

  $("#btn-load-sample").addEventListener("click", async () => {
    try {
      runInput.value = await fetchText("sample-run.md");
      reportEl.innerHTML = "";
      status("Loaded a clean sample run. Evaluate it to see a pass.", "ok");
    } catch (err) {
      status(err.message, "err");
    }
  });

  $("#btn-clear-run").addEventListener("click", () => {
    runInput.value = "";
    reportEl.innerHTML = "";
  });

  function renderReport(violations) {
    reportEl.innerHTML = "";
    const errs = violations.filter((v) => v.severity === "error").length;
    const warns = violations.filter((v) => v.severity === "warn").length;

    const summary = document.createElement("div");
    summary.className = "report-summary " + (errs ? "fail" : warns ? "warnonly" : "pass");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = errs ? "FAIL" : warns ? "PASS (warnings)" : "PASS";
    summary.appendChild(badge);
    const summaryText = document.createElement("span");
    summaryText.textContent = violations.length
      ? errs + " error(s), " + warns + " warning(s)."
      : "No violations. This run passes every hard rule.";
    summary.appendChild(summaryText);
    reportEl.appendChild(summary);

    if (!violations.length) return;
    const list = document.createElement("ul");
    list.className = "violations";
    for (const v of violations) {
      const li = document.createElement("li");
      li.className = v.severity;
      const sev = document.createElement("span");
      sev.className = "v-sev";
      sev.textContent = v.severity;
      const body = document.createElement("div");
      body.className = "v-body";
      const code = document.createElement("span");
      code.className = "v-code";
      code.textContent = v.code;
      body.appendChild(code);
      if (v.entry) {
        const entry = document.createElement("span");
        entry.className = "v-entry";
        entry.textContent = " \u2014 " + v.entry;
        body.appendChild(entry);
      }
      const msg = document.createElement("span");
      msg.className = "v-msg";
      msg.textContent = v.message;
      body.appendChild(msg);
      li.appendChild(sev);
      li.appendChild(body);
      list.appendChild(li);
    }
    reportEl.appendChild(list);
  }

  /* ---------- rolodex ---------- */
  const dnrBody = $("#dnr-body");
  const dnrEmpty = $("#dnr-empty");

  function renderRolodex() {
    const entries = Rolodex.load();
    dnrBody.innerHTML = "";
    dnrEmpty.hidden = entries.length > 0;
    entries.forEach((entry, idx) => dnrBody.appendChild(rolodexRow(entry, idx)));
  }

  function rolodexRow(entry, idx) {
    const tr = document.createElement("tr");
    for (const col of Rolodex.COLUMNS) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = entry[col] || "";
      input.setAttribute("aria-label", col);
      input.addEventListener("change", () => {
        const all = Rolodex.load();
        if (all[idx]) { all[idx][col] = input.value; Rolodex.save(all); }
      });
      td.appendChild(input);
      tr.appendChild(td);
    }
    const actions = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost btn-sm";
    remove.setAttribute("aria-label", "Remove entry");
    remove.textContent = "\u2715";
    remove.addEventListener("click", () => {
      const all = Rolodex.load();
      all.splice(idx, 1);
      Rolodex.save(all);
      renderRolodex();
    });
    actions.appendChild(remove);
    tr.appendChild(actions);
    return tr;
  }

  $("#btn-dnr-add").addEventListener("click", () => {
    const all = Rolodex.load();
    all.push(Rolodex.normalize({}));
    Rolodex.save(all);
    renderRolodex();
    const inputs = dnrBody.querySelectorAll("tr:last-child input");
    if (inputs.length) inputs[0].focus();
  });

  $("#btn-dnr-export").addEventListener("click", () => {
    downloadText("do-not-resurface.md", Rolodex.toMarkdown(Rolodex.load()));
    status("Exported do-not-resurface.md", "ok");
  });

  $("#dnr-import-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = Rolodex.fromMarkdown(String(reader.result));
      const existing = Rolodex.load();
      const seen = new Set(existing.map((x) => (x.name + "|" + x.project).toLowerCase()));
      let added = 0;
      for (const row of imported) {
        const key = (row.name + "|" + row.project).toLowerCase();
        if (!seen.has(key)) { existing.push(row); seen.add(key); added++; }
      }
      Rolodex.save(existing);
      renderRolodex();
      status("Imported " + added + " new " + (added === 1 ? "entry" : "entries") + ".", "ok");
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  $("#btn-dnr-clear").addEventListener("click", () => {
    if (!Rolodex.load().length) return;
    if (confirm("Clear all rolodex entries from this browser?")) {
      Rolodex.save([]);
      renderRolodex();
      status("Rolodex cleared.", "ok");
    }
  });

  /* ---------- reference ---------- */
  const refSelect = $("#ref-select");
  const refDoc = $("#ref-doc");
  const refCache = {};

  async function loadReference() {
    const name = refSelect.value;
    if (!(name in refCache)) {
      try {
        refCache[name] = await fetchText(name);
      } catch (err) {
        refDoc.innerHTML = "<p>Could not load " + name + ". Serve the folder over http (see the README).</p>";
        return;
      }
    }
    refDoc.innerHTML = MiniMarkdown.render(refCache[name]);
  }
  refSelect.addEventListener("change", loadReference);

  /* ---------- helpers ---------- */
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------- init ---------- */
  showTab("prep");
})();
