"use client";

import { useState, type FormEvent } from "react";

type Entry = {
  id: string;
  weekOf: string;
  note: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: { displayName: string };
  updatedBy: { displayName: string };
  revisions: Array<{
    id: string;
    revision: number;
    note: string;
    createdAt: string;
    editedBy: { displayName: string };
  }>;
};

export function TasteLogEditor({ entries }: { entries: Entry[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/taste-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekOf: form.get("weekOf"), note: form.get("note") }),
    });
    const body = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      setMessage(body.error?.message ?? "The observation could not be added.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  async function edit(entry: Entry, formData: FormData) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/taste-log/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: entry.version, note: formData.get("note") }),
    });
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      setMessage(body.error?.code === "VERSION_CONFLICT" ? "This observation changed elsewhere. Refresh before retrying." : (body.error?.message ?? "The correction could not be saved."));
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="page-stack">
      <form className="form-card taste-create" onSubmit={create}>
        <label><span>Week of</span><input name="weekOf" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label><span>Observation</span><textarea name="note" maxLength={10_000} placeholder="What the latest run nailed or missed" required /></label>
        <button className="primary-button" disabled={busy} type="submit">Add observation</button>
        {message ? <p className="form-error" role="alert">{message}</p> : null}
      </form>
      <section className="history-list" aria-label="Taste log history">
        {entries.map((entry) => (
          <article className="history-card" key={entry.id}>
            <div className="history-heading">
              <div><p className="eyebrow">Week of {entry.weekOf}</p><h2>{entry.note}</h2></div>
              <small>v{entry.version}</small>
            </div>
            <p className="muted-copy">Created by {entry.createdBy.displayName} · last edited by {entry.updatedBy.displayName} on {entry.updatedAt.slice(0, 10)}</p>
            <details>
              <summary>Correct this entry</summary>
              <form action={edit.bind(null, entry)} className="inline-edit-form">
                <label><span>Corrected observation</span><textarea name="note" defaultValue={entry.note} maxLength={10_000} required /></label>
                <button className="secondary-button" disabled={busy} type="submit">Save correction</button>
              </form>
            </details>
            <details>
              <summary>{entry.revisions.length} immutable revision(s)</summary>
              <ol className="note-history">
                {entry.revisions.map((revision) => (
                  <li key={revision.id}><p>{revision.note}</p><small>Revision {revision.revision} · {revision.editedBy.displayName} · {revision.createdAt.slice(0, 10)}</small></li>
                ))}
              </ol>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
