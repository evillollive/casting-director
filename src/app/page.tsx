import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { SetupNotice } from "@/components/setup-notice";

export default function ShortlistPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Editorial desk"
        title="Shortlist"
        description="The newest completed, evaluator-clean scan will appear here."
        action={
          <button className="primary-button" disabled title="Worker lands later">
            Start scan
          </button>
        }
      />
      <SetupNotice
        items={[
          {
            label: "DATABASE_URL",
            configured: Boolean(process.env.DATABASE_URL),
            hint: "PostgreSQL connection URL",
          },
          {
            label: "CASTING_AUTH_SECRET",
            configured: Boolean(process.env.CASTING_AUTH_SECRET),
            hint: "32 or more random characters",
          },
        ]}
      />
      <section className="metric-grid" aria-label="Workspace summary">
        <article className="metric-card">
          <span>Qualified</span>
          <strong>0</strong>
          <small>Protagonist and hook gates passed</small>
        </article>
        <article className="metric-card">
          <span>Parking lot</span>
          <strong>0</strong>
          <small>Worth revisiting when timing changes</small>
        </article>
        <article className="metric-card">
          <span>Evaluator</span>
          <strong className="metric-neutral">Waiting</strong>
          <small>No completed scan</small>
        </article>
      </section>
      <section className="contract-card">
        <div>
          <p className="eyebrow">Non-negotiable release gate</p>
          <h2>Two dimensions qualify a candidate</h2>
          <p>
            Protagonist must be at least 3 and Visible hook must be at least 3.
            Overall score remains editorial context, never a substitute.
          </p>
        </div>
        <div className="gate-pair" aria-label="Required shortlist scores">
          <span>Protagonist ≥ 3</span>
          <span>Visible hook ≥ 3</span>
        </div>
      </section>
      <EmptyState marker="01" title="No completed scan yet">
        Layer 1 establishes the workspace, contracts, and durable model. The
        background scan worker is intentionally reserved for a later layer.
      </EmptyState>
    </div>
  );
}
