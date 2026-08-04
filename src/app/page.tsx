import Link from "next/link";
import { AccessState } from "@/components/access-state";
import { CandidateQuickActions } from "@/components/candidate-quick-actions";
import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { ScoreBadge } from "@/components/score-badge";
import { prisma } from "@/server/db";
import { resolvePageAccess } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";

export default async function ShortlistPage() {
  const access = await resolvePageAccess();
  if (access.state !== "authenticated") {
    return <div className="page-stack"><AccessState access={access} /></div>;
  }

  const scan = await prisma.scan.findFirst({
    where: {
      workspaceId: access.principal.workspaceId,
      status: "COMPLETED",
      evalPassed: true,
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    include: {
      evaluatorViolations: { orderBy: { createdAt: "asc" } },
      candidates: {
        where: {
          placement: "SHORTLIST",
          candidate: {
            doNotResurface: false,
            notForSurfacing: false,
          },
        },
        orderBy: [{ rank: "asc" }],
        include: {
          candidate: {
            include: {
              provenance: {
                orderBy: { lastSeenAt: "desc" },
                take: 1,
                include: { source: true },
              },
            },
          },
        },
      },
    },
  });

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Editorial desk"
        title="Shortlist"
        description="The newest completed, evaluator-clean report and its current rolodex decisions."
        action={<Link className="primary-button button-link" href="/scans/live">Start scan</Link>}
      />
      <section className="contract-card">
        <div>
          <p className="eyebrow">Non-negotiable release gate</p>
          <h2>Protagonist ≥ 3 and Visible hook ≥ 3</h2>
          <p>Overall score remains editorial context, never a substitute.</p>
        </div>
        <div className="gate-pair" aria-label="Required shortlist scores">
          <span>Canonical evaluator</span>
          <span>{scan ? "Passed" : "Waiting"}</span>
        </div>
      </section>
      {!scan ? (
        <EmptyState marker="01" title="No shippable completed scan">
          Run a live scan. Failed or evaluator-rejected reports remain diagnostics and never appear here.
        </EmptyState>
      ) : (
        <>
          <section className="metric-grid" aria-label="Latest scan summary">
            <article className="metric-card"><span>Current shortlist</span><strong>{scan.candidates.length}</strong><small>{scan.shortlistCount} in the immutable report · {scan.runDate.toISOString().slice(0, 10)}</small></article>
            <article className="metric-card"><span>Parking lot</span><strong>{scan.parkingCount}</strong><small>Preserved in immutable report</small></article>
            <article className="metric-card"><span>Evaluator</span><strong className="metric-success">Passed</strong><small>{scan.evaluatorViolations.length} recorded findings</small></article>
          </section>
          {scan.candidates.length === 0 ? (
            <EmptyState marker="01" title="No currently eligible candidates">
              The immutable report completed successfully, but its candidates are now marked do-not-resurface or not-for-surfacing.
            </EmptyState>
          ) : <section className="candidate-grid" aria-label="Shortlisted candidates">
            {scan.candidates.map((appearance) => {
              const candidate = appearance.candidate;
              const provenance = candidate.provenance[0];
              return (
                <article className="candidate-card" key={appearance.id}>
                  <div className="candidate-card-heading">
                    <div>
                      <p className="eyebrow">Rank {appearance.rank ?? "—"}</p>
                      <h2>{candidate.name}</h2>
                      <p className="muted-copy">{candidate.project ?? candidate.handle ?? "Independent work"}</p>
                    </div>
                    <ScoreBadge score={appearance.overallScore} />
                  </div>
                  <p className="candidate-hook">{appearance.hook}</p>
                  <dl className="brief-details">
                    <div><dt>Why now</dt><dd>{appearance.whyNow}</dd></div>
                    <div><dt>Rationale</dt><dd>{appearance.rationale}</dd></div>
                    {appearance.caveat ? <div><dt>Caveat</dt><dd>{appearance.caveat}</dd></div> : null}
                    {appearance.sensitivity ? <div><dt>Sensitivity</dt><dd>{appearance.sensitivity}</dd></div> : null}
                  </dl>
                  <div className="score-pair">
                    <ScoreBadge label="Protagonist" score={appearance.protagonistScore} />
                    <ScoreBadge label="Visible hook" score={appearance.visibleHookScore} />
                  </div>
                  {provenance ? (
                    <a className="source-link" href={provenance.sourceUrl} target="_blank" rel="noreferrer">
                      {provenance.source.displayName} source ↗
                    </a>
                  ) : null}
                  <CandidateQuickActions
                    candidateId={candidate.id}
                    initialStatus={candidate.status}
                    initialVersion={candidate.version}
                    initialDoNotResurface={candidate.doNotResurface}
                  />
                </article>
              );
            })}
          </section>}
        </>
      )}
    </div>
  );
}
