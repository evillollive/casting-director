/*
 * markdown.js: a tiny, dependency-free Markdown-to-HTML renderer.
 *
 * Deliberately minimal. It covers exactly what the bundled reference docs use:
 * headings, paragraphs, unordered/ordered lists, fenced and inline code,
 * bold, links, horizontal rules, and GitHub-style tables. All input is
 * HTML-escaped first, so it is safe to inject the result with innerHTML.
 */
(function (root) {
  "use strict";

  function esc(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function inline(s) {
    // code spans first, protected from further formatting
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      codes.push("<code>" + c + "</code>");
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // links [text](url) — only http(s) and relative anchors allowed
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      if (/^(https?:|#|\.|\/|mailto:)/i.test(url)) {
        return '<a href="' + url + '" rel="noopener noreferrer">' + text + "</a>";
      }
      return text;
    });
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
    return s;
  }

  function renderTable(rows) {
    // rows: array of raw "| a | b |" strings (>= 2, second is separator)
    const cells = (line) =>
      line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    let html = "<table><thead><tr>";
    for (const h of head) html += "<th>" + inline(esc(h)) + "</th>";
    html += "</tr></thead><tbody>";
    for (const r of body) {
      html += "<tr>";
      for (const c of r) html += "<td>" + inline(esc(c)) + "</td>";
      html += "</tr>";
    }
    return html + "</tbody></table>";
  }

  function render(md) {
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let listType = null;
    const closeList = () => {
      if (listType) { out.push("</" + listType + ">"); listType = null; }
    };

    while (i < lines.length) {
      const line = lines[i];

      // fenced code block
      const fence = /^```/.test(line);
      if (fence) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        i++;
        out.push("<pre><code>" + buf.join("\n") + "</code></pre>");
        continue;
      }

      // table block
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        closeList();
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        out.push(renderTable(rows));
        continue;
      }

      // heading
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        closeList();
        const level = h[1].length;
        out.push("<h" + level + ">" + inline(esc(h[2])) + "</h" + level + ">");
        i++;
        continue;
      }

      // horizontal rule
      if (/^\s*---+\s*$/.test(line)) { closeList(); out.push("<hr />"); i++; continue; }

      // ordered list
      const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (ol) {
        if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
        out.push("<li>" + inline(esc(ol[1])) + "</li>");
        i++;
        continue;
      }

      // unordered list
      const ul = /^\s*[-*]\s+(.*)$/.exec(line);
      if (ul) {
        if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
        out.push("<li>" + inline(esc(ul[1])) + "</li>");
        i++;
        continue;
      }

      // blank line
      if (/^\s*$/.test(line)) { closeList(); i++; continue; }

      // paragraph (gather consecutive plain lines)
      closeList();
      const para = [line];
      i++;
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^(#{1,6})\s/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^\s*\|/.test(lines[i]) &&
        !/^\s*---+\s*$/.test(lines[i])
      ) { para.push(lines[i]); i++; }
      out.push("<p>" + inline(esc(para.join(" "))) + "</p>");
    }
    closeList();
    return out.join("\n");
  }

  root.MiniMarkdown = { render };
})(typeof window !== "undefined" ? window : globalThis);
