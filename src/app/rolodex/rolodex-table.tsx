"use client";

import { useState } from "react";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge, candidateStatuses } from "@/components/status-badge";

type CandidateStatus = (typeof candidateStatuses)[number];
type CandidateRow = {
  id: string;
  name: string;
  handle: string | null;
  project: string | null;
  projectUrl: string | null;
  region: string | null;
  overallScore: number | null;
  status: CandidateStatus;
  doNotResurface: boolean;
  notForSurfacing: boolean;
  lastSeenAt: string;
  tags: Array<{ tag: { id: string; name: string } }>;
  notes: Array<{ id: string; body: string; createdAt: string; author: { displayName: string } }>;
  provenance: Array<{
    id: string;
    sourceUrl: string;
    firstSeenAt: string;
    lastSeenAt: string;
    source: { displayName: string; family: string };
  }>;
};

export function RolodexTable({
  items,
  availableTags,
}: {
  items: CandidateRow[];
  availableTags: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<CandidateStatus | "">("");
  const [tagId, setTagId] = useState("");
  const [dnr, setDnr] = useState<"" | "true" | "false">("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyBulk() {
    const payload: Record<string, unknown> = { candidateIds: [...selected] };
    if (status) payload.status = status;
    if (tagId) payload.tagIds = [tagId];
    if (dnr) payload.doNotResurface = dnr === "true";
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/candidates/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as {
      updatedCount?: number;
      error?: { message?: string };
    };
    if (!response.ok) {
      setMessage(body.error?.message ?? "The bulk change could not be applied.");
      setBusy(false);
      return;
    }
    setMessage(`${body.updatedCount ?? selected.size} candidate(s) updated.`);
    window.location.reload();
  }

  return (
    <div className="page-stack">
      <section className="bulk-bar" aria-label="Bulk candidate actions">
        <strong>{selected.size} selected</strong>
        <label><span className="sr-only">Bulk status</span><select value={status} onChange={(event) => setStatus(event.target.value as CandidateStatus | "")}><option value="">Keep status</option>{candidateStatuses.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label>
        <label><span className="sr-only">Bulk tag replacement</span><select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">Keep tags</option>{availableTags.map((tag) => <option key={tag.id} value={tag.id}>Replace with {tag.name}</option>)}</select></label>
        <label><span className="sr-only">Bulk do-not-resurface</span><select value={dnr} onChange={(event) => setDnr(event.target.value as typeof dnr)}><option value="">Keep DNR</option><option value="true">Do not resurface</option><option value="false">Allow resurfacing</option></select></label>
        <button className="secondary-button" disabled={busy || selected.size === 0 || (!status && !tagId && !dnr)} type="button" onClick={() => void applyBulk()}>Apply</button>
        {message ? <span role="status">{message}</span> : null}
      </section>
      <section className="rolodex-list" aria-label="Candidates">
        {items.map((candidate) => (
          <article className="rolodex-card" key={candidate.id}>
            <div className="rolodex-main">
              <label className="candidate-select">
                <input
                  type="checkbox"
                  checked={selected.has(candidate.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(candidate.id);
                    else next.delete(candidate.id);
                    setSelected(next);
                  }}
                />
                <span className="sr-only">Select {candidate.name}</span>
              </label>
              <div className="candidate-identity">
                <h2>{candidate.name}</h2>
                <p>{candidate.handle ?? candidate.project ?? "No handle or project"}</p>
                <div className="tag-list">{candidate.tags.map(({ tag }) => <span key={tag.id}>{tag.name}</span>)}</div>
              </div>
              <StatusBadge status={candidate.status} />
              {candidate.overallScore === null ? <span className="muted-copy">Not scored</span> : <ScoreBadge score={candidate.overallScore} />}
              <div className="candidate-flags">
                {candidate.doNotResurface ? <span className="danger-chip">DNR</span> : null}
                {candidate.notForSurfacing ? <span className="warning-chip">Not for surfacing</span> : null}
              </div>
              <time dateTime={candidate.lastSeenAt}>{candidate.lastSeenAt.slice(0, 10)}</time>
            </div>
            <details>
              <summary>Notes and provenance</summary>
              <div className="detail-columns">
                <section>
                  <h3>Authored note history</h3>
                  {candidate.notes.length === 0 ? <p className="muted-copy">No notes yet.</p> : (
                    <ol className="note-history">
                      {candidate.notes.map((note) => (
                        <li key={note.id}><p>{note.body}</p><small>{note.author.displayName} · {note.createdAt.slice(0, 10)}</small></li>
                      ))}
                    </ol>
                  )}
                </section>
                <section>
                  <h3>Source appearances</h3>
                  <ul className="provenance-list">
                    {candidate.provenance.map((provenance) => (
                      <li key={provenance.id}>
                        <a href={provenance.sourceUrl} target="_blank" rel="noreferrer">{provenance.source.displayName} ↗</a>
                        <small>{provenance.source.family.toLowerCase()} · first {provenance.firstSeenAt.slice(0, 10)} · latest {provenance.lastSeenAt.slice(0, 10)}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
