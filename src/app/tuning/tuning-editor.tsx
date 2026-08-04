"use client";

import { useState, type FormEvent } from "react";

type Revision = {
  id: string;
  revision: number;
  beat: string;
  createdAt: string;
  createdBy: { displayName: string };
  hardNos: string[];
  moreOf: string[];
};

export function TuningEditor({
  initial,
  revisions,
}: {
  initial: { version: number; beat: string; hardNos: string[]; moreOf: string[] };
  revisions: Revision[];
}) {
  const [beat, setBeat] = useState(initial.beat);
  const [hardNos, setHardNos] = useState(initial.hardNos.join("\n"));
  const [moreOf, setMoreOf] = useState(initial.moreOf.join("\n"));
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

  async function requestPreview() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/prompt-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ beat, hardNos: lines(hardNos), moreOf: lines(moreOf) }),
    });
    const body = (await response.json()) as { prompt?: string; error?: { message?: string } };
    if (!response.ok || !body.prompt) {
      setMessage(body.error?.message ?? "The canonical preview could not be generated.");
    } else {
      setPreview(body.prompt);
    }
    setBusy(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/tuning", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: initial.version,
        beat,
        hardNos: lines(hardNos),
        moreOf: lines(moreOf),
      }),
    });
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      setMessage(body.error?.code === "VERSION_CONFLICT" ? "Tuning changed elsewhere. Refresh before saving." : (body.error?.message ?? "The revision could not be saved."));
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="page-stack">
      <form className="form-card" onSubmit={save}>
        <label><span>Beat / theme focus</span><textarea value={beat} onChange={(event) => setBeat(event.target.value)} required /></label>
        <div className="form-columns">
          <label><span>Hard nos</span><textarea value={hardNos} onChange={(event) => setHardNos(event.target.value)} placeholder="One exclusion per line" /></label>
          <label><span>More of</span><textarea value={moreOf} onChange={(event) => setMoreOf(event.target.value)} placeholder="One desired pattern per line" /></label>
        </div>
        <div className="form-actions">
          <button className="primary-button" disabled={busy} type="submit">Save immutable revision</button>
          <button className="secondary-button" disabled={busy} type="button" onClick={() => void requestPreview()}>Generate canonical preview</button>
        </div>
        {message ? <p className="form-error" role="alert">{message}</p> : null}
      </form>
      {preview ? <section className="boundary-card"><p className="eyebrow">Canonical Python output</p><h2>Generated prompt preview</h2><pre className="prompt-preview">{preview}</pre></section> : null}
      <section className="history-list">
        <div><p className="eyebrow">Immutable audit</p><h2>Revision history</h2></div>
        {revisions.length === 0 ? <p className="muted-copy">The next save creates revision 1.</p> : revisions.map((revision) => (
          <details className="history-card" key={revision.id}>
            <summary>Revision {revision.revision} · {revision.createdAt.slice(0, 10)} · {revision.createdBy.displayName}</summary>
            <p><strong>Beat:</strong> {revision.beat}</p>
            <p><strong>Hard nos:</strong> {revision.hardNos.join("; ") || "None"}</p>
            <p><strong>More of:</strong> {revision.moreOf.join("; ") || "None"}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
