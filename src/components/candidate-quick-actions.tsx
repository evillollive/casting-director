"use client";

import { useState } from "react";
import { StatusBadge, candidateStatuses } from "@/components/status-badge";

type CandidateStatus = (typeof candidateStatuses)[number];

export function CandidateQuickActions({
  candidateId,
  initialStatus,
  initialVersion,
  initialDoNotResurface,
}: {
  candidateId: string;
  initialStatus: CandidateStatus;
  initialVersion: number;
  initialDoNotResurface: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [version, setVersion] = useState(initialVersion);
  const [doNotResurface, setDoNotResurface] = useState(initialDoNotResurface);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, ...payload }),
    });
    const body = (await response.json()) as {
      item?: { version: number; status: CandidateStatus; doNotResurface: boolean };
      error?: { code: string; message: string };
    };
    if (!response.ok || !body.item) {
      setMessage(
        body.error?.code === "VERSION_CONFLICT"
          ? "This candidate changed elsewhere. Refresh before retrying."
          : (body.error?.message ?? "The change could not be saved."),
      );
      setBusy(false);
      return;
    }
    setVersion(body.item.version);
    setStatus(body.item.status);
    setDoNotResurface(body.item.doNotResurface);
    setMessage("Saved.");
    setBusy(false);
    if (payload.doNotResurface === true) window.location.reload();
  }

  async function addNote(formData: FormData) {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return;
    await patch({ note });
  }

  return (
    <div className="quick-actions">
      <div className="quick-action-row">
        <StatusBadge status={status} />
        <label>
          <span className="sr-only">Set candidate status</span>
          <select
            disabled={busy}
            value={status}
            onChange={(event) => void patch({ status: event.target.value })}
          >
            {candidateStatuses.map((item) => (
              <option key={item} value={item}>{item.replace("_", " ").toLowerCase()}</option>
            ))}
          </select>
        </label>
        <button
          className="text-button"
          disabled={busy}
          type="button"
          onClick={() => void patch({ doNotResurface: !doNotResurface })}
        >
          {doNotResurface ? "Allow resurfacing" : "Do not resurface"}
        </button>
      </div>
      <form action={addNote} className="inline-note-form">
        <label>
          <span className="sr-only">Append an authored note</span>
          <input name="note" placeholder="Append a note" maxLength={10_000} required />
        </label>
        <button className="secondary-button" disabled={busy} type="submit">Add note</button>
      </form>
      {message ? <p className="action-message" role="status">{message}</p> : null}
    </div>
  );
}
