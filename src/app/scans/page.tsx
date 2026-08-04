import Link from "next/link";
import { AccessState } from "@/components/access-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { ScanStatusBadge } from "@/components/scan-status-badge";
import { prisma } from "@/server/db";
import { resolvePageAccess } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan history" };

export default async function ScansPage() {
  const access = await resolvePageAccess();
  if (access.state !== "authenticated") {
    return <div className="page-stack"><AccessState access={access} /></div>;
  }
  const scans = await prisma.scan.findMany({
    where: { workspaceId: access.principal.workspaceId },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    include: {
      sources: { include: { source: true }, orderBy: { createdAt: "asc" } },
      evaluatorViolations: { orderBy: { createdAt: "asc" } },
    },
  });
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Immutable audit"
        title="Scan history"
        description="Every run retains source coverage, counts, execution snapshots, evaluator findings, and immutable output."
        action={<Link className="primary-button button-link" href="/scans/live">Start scan</Link>}
      />
      {scans.length === 0 ? (
        <EmptyState marker="02" title="No scan records">Start a live scan after the worker and model endpoint are configured.</EmptyState>
      ) : (
        <section className="history-list" aria-label="Scan history">
          {scans.map((scan) => {
            const shippable = scan.status === "COMPLETED" && scan.evalPassed === true;
            return (
              <article className="history-card" key={scan.id}>
                <div className="history-heading">
                  <div>
                    <p className="eyebrow">{scan.runDate.toISOString().slice(0, 10)}</p>
                    <h2>{scan.summary ?? `Scan ${scan.id}`}</h2>
                  </div>
                  <ScanStatusBadge status={scan.status} />
                </div>
                <div className="count-strip">
                  <span><strong>{scan.candidatesFetched}</strong> fetched</span>
                  <span><strong>{scan.candidatesScreened}</strong> screened</span>
                  <span><strong>{scan.shortlistCount}</strong> shortlisted</span>
                  <span><strong>{scan.parkingCount}</strong> parked</span>
                </div>
                <ul className="coverage-list">
                  {scan.sources.map((source) => (
                    <li key={source.id}>
                      <span>{source.source.displayName}</span>
                      <ScanStatusBadge status={source.status} />
                      <small>{source.fetchedCount} fetched{source.errorCode ? ` · ${source.errorCode}` : ""}</small>
                    </li>
                  ))}
                </ul>
                {scan.error ? <p className="form-error">{scan.error}</p> : null}
                {scan.evaluatorViolations.length > 0 ? (
                  <details>
                    <summary>{scan.evaluatorViolations.length} evaluator violation(s)</summary>
                    <ul className="violation-list">
                      {scan.evaluatorViolations.map((violation) => (
                        <li key={violation.id}><strong>{violation.severity} · {violation.code}</strong><span>{violation.message}</span></li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {scan.reportMarkdown ? (
                  <details>
                    <summary>{shippable ? "Immutable report" : "Diagnostic report — not shippable"}</summary>
                    <pre className={shippable ? "report-preview" : "report-preview diagnostic"}>{scan.reportMarkdown}</pre>
                  </details>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
