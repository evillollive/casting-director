"use client";

import { useState } from "react";

type Conflict = {
  id: string;
  normalizedIdentity: string;
  databaseSnapshot: unknown;
  markdownSnapshot: unknown;
  version: number;
  syncState: { document: string };
};

export function SyncPanel({
  initialConflicts,
}: {
  initialConflicts: Conflict[];
}) {
  const [conflicts, setConflicts] = useState<Conflict[]>(initialConflicts);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadConflicts() {
    const response = await fetch("/api/rolodex/conflicts");
    const body = (await response.json()) as {
      items?: Conflict[];
      error?: { message?: string };
    };
    if (!response.ok) {
      setMessage(body.error?.message ?? "Conflicts could not be loaded.");
      return;
    }
    setConflicts(body.items ?? []);
  }

  async function reconcile() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/rolodex/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "RECONCILE" }),
    });
    const body = (await response.json()) as {
      accepted?: boolean;
      documents?: string[];
      jobs?: Array<{ id: string; status: string }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      setBusy(false);
      setMessage(body.error?.message ?? "Repository reconciliation failed.");
      return;
    }
    setMessage(
      `Reconciliation queued for ${body.documents?.length ?? 0} document(s).`,
    );
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const statusResponse = await fetch("/api/rolodex/sync");
      const statusBody = (await statusResponse.json()) as {
        jobs?: Array<{ id: string; status: string; lastError?: string | null }>;
        openConflicts?: number;
      };
      if (!statusResponse.ok) break;
      const requested = new Set(body.jobs?.map(({ id }) => id) ?? []);
      const jobs = statusBody.jobs?.filter(({ id }) => requested.has(id)) ?? [];
      if (
        jobs.length > 0 &&
        jobs.every(({ status }) => status === "SUCCEEDED" || status === "FAILED")
      ) {
        await loadConflicts();
        const failed = jobs.find(({ status }) => status === "FAILED");
        setMessage(
          failed
            ? failed.lastError ?? "Repository reconciliation failed."
            : statusBody.openConflicts
              ? `${statusBody.openConflicts} conflict(s) require a decision.`
              : "Repository and database memory are synchronized.",
        );
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setMessage("Reconciliation is still running; refresh to check its result.");
  }

  async function resolve(
    conflict: Conflict,
    resolution: "DATABASE" | "MARKDOWN",
  ) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(
      `/api/rolodex/conflicts/${conflict.id}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution, version: conflict.version }),
      },
    );
    const body = (await response.json()) as { error?: { message?: string } };
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error?.message ?? "Conflict resolution failed.");
      return;
    }
    setMessage(
      resolution === "DATABASE"
        ? "Database value retained; a durable repository export was queued."
        : "Markdown value was explicitly applied to Postgres.",
    );
    await loadConflicts();
  }

  return (
    <section className="content-card page-stack" aria-labelledby="repository-sync-title">
      <div>
        <p className="eyebrow">Repository interoperability</p>
        <h2 id="repository-sync-title">Markdown sync</h2>
        <p className="muted-copy">
          Postgres remains authoritative. Reconciliation never clears a DNR row
          without an explicit markdown resolution.
        </p>
      </div>
      <div className="button-row">
        <button
          className="secondary-button"
          disabled={busy}
          type="button"
          onClick={() => void reconcile()}
        >
          {busy ? "Working…" : "Reconcile repository"}
        </button>
        {message ? <span role="status">{message}</span> : null}
      </div>
      {conflicts.length > 0 ? (
        <div className="page-stack">
          <h3>Open conflicts</h3>
          {conflicts.map((conflict) => (
            <article className="content-card" key={conflict.id}>
              <strong>
                {conflict.syncState.document.replaceAll("_", " ")} ·{" "}
                {conflict.normalizedIdentity}
              </strong>
              <details>
                <summary>Compare snapshots</summary>
                <pre>{JSON.stringify({
                  database: conflict.databaseSnapshot,
                  markdown: conflict.markdownSnapshot,
                }, null, 2)}</pre>
              </details>
              <div className="button-row">
                <button
                  className="secondary-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void resolve(conflict, "DATABASE")}
                >
                  Keep database
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void resolve(conflict, "MARKDOWN")}
                >
                  Apply markdown
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
