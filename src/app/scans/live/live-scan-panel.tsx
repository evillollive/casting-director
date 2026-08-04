"use client";

import { useEffect, useState } from "react";
import { ScanStatusBadge } from "@/components/scan-status-badge";

type Source = { key: string; displayName: string; family: string };
export type ScanDetail = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  error: string | null;
  candidatesFetched: number;
  candidatesDeduped: number;
  candidatesScreened: number;
  shortlistCount: number;
  parkingCount: number;
  shippable: boolean;
  diagnosticReportMarkdown: string | null;
  sourceProgress: Array<{
    id: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    fetchedCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    source: { key: string; displayName: string };
  }>;
  evaluatorViolations: Array<{ id: string; severity: string; code: string; message: string }>;
  job: { attempt: number; maxAttempts: number; failureCode: string | null; lastError: string | null } | null;
};

export function LiveScanPanel({
  sources,
  initialScan = null,
}: {
  sources: Source[];
  initialScan?: ScanDetail | null;
}) {
  const [selected, setSelected] = useState(() => new Set(sources.map((source) => source.key)));
  const [scan, setScan] = useState<ScanDetail | null>(initialScan);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scan || (scan.status !== "PENDING" && scan.status !== "RUNNING")) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/scans/${scan.id}`, { cache: "no-store" });
      if (!response.ok) {
        setError("Polling failed. The scan may still be running.");
        return;
      }
      setScan((await response.json()) as ScanDetail);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [scan]);

  async function startScan() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runDate: new Date().toISOString().slice(0, 10),
        sourceKeys: [...selected],
      }),
    });
    const body = (await response.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!response.ok || !body.id) {
      setError(body.error?.message ?? "The scan could not be started.");
      setBusy(false);
      return;
    }
    const detail = await fetch(`/api/scans/${body.id}`, { cache: "no-store" });
    if (!detail.ok) {
      setError("The scan started, but its status could not be loaded.");
      setBusy(false);
      return;
    }
    setScan((await detail.json()) as ScanDetail);
    setBusy(false);
  }

  return (
    <div className="page-stack">
      <section className="form-card">
        <fieldset className="source-picker" disabled={busy || scan?.status === "RUNNING"}>
          <legend>Source coverage</legend>
          {sources.map((source) => (
            <label key={source.key}>
              <input
                type="checkbox"
                checked={selected.has(source.key)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(source.key);
                  else next.delete(source.key);
                  setSelected(next);
                }}
              />
              <span><strong>{source.displayName}</strong><small>{source.family.toLowerCase()}</small></span>
            </label>
          ))}
        </fieldset>
        <button className="primary-button" disabled={busy || selected.size === 0 || scan?.status === "RUNNING"} type="button" onClick={() => void startScan()}>
          {busy ? "Starting…" : "Start live scan"}
        </button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
      {scan ? (
        <section className="live-scan-card" aria-live="polite">
          <div className="live-scan-heading">
            <div><p className="eyebrow">Scan {scan.id}</p><h2>Live progress</h2></div>
            <ScanStatusBadge status={scan.status} />
          </div>
          <div className="count-strip">
            <span><strong>{scan.candidatesFetched}</strong> fetched</span>
            <span><strong>{scan.candidatesDeduped}</strong> deduped</span>
            <span><strong>{scan.candidatesScreened}</strong> screened</span>
            <span><strong>{scan.shortlistCount}</strong> shortlisted</span>
            <span><strong>{scan.parkingCount}</strong> parked</span>
          </div>
          <ul className="source-progress">
            {scan.sourceProgress.map((source) => (
              <li key={source.id}>
                <div><strong>{source.source.displayName}</strong><small>{source.fetchedCount} fetched</small></div>
                <ScanStatusBadge status={source.status} />
                {source.errorMessage ? <p className="form-error">{source.errorCode}: {source.errorMessage}</p> : null}
              </li>
            ))}
          </ul>
          {scan.status === "FAILED" ? (
            <div className="failure-panel" role="alert">
              <h2>Scan failed — diagnostic only</h2>
              <p>{scan.error ?? scan.job?.lastError ?? "The worker did not produce a shippable report."}</p>
              {scan.job?.failureCode ? <p><code>{scan.job.failureCode}</code> after {scan.job.attempt}/{scan.job.maxAttempts} attempts</p> : null}
              {scan.evaluatorViolations.map((violation) => (
                <p key={violation.id}><strong>{violation.code}</strong>: {violation.message}</p>
              ))}
              {scan.diagnosticReportMarkdown ? <details><summary>Partial diagnostic report</summary><pre>{scan.diagnosticReportMarkdown}</pre></details> : null}
            </div>
          ) : null}
          {scan.shippable ? <p className="success-panel">Completed and evaluator-clean. The report is available in Shortlist and Scan history.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
