import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";

const lifecycle = ["Pending", "Running", "Completed", "Failed"] as const;

export const metadata = { title: "Scans" };

export default function ScansPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Operations"
        title="Scan history"
        description="Coverage, output snapshots, and evaluator findings remain attached to every run."
        action={
          <button className="primary-button" disabled>
            Start scan
          </button>
        }
      />
      <section className="lifecycle-card">
        <div>
          <p className="eyebrow">Durable job contract</p>
          <h2>One active scan per workspace</h2>
        </div>
        <ol className="lifecycle">
          {lifecycle.map((status, index) => (
            <li key={status}>
              <span>{index + 1}</span>
              {status}
            </li>
          ))}
        </ol>
        <p className="muted-copy">
          A scan can complete only after the canonical Python evaluator passes
          with no ERROR violations. Individual source failures stay isolated
          and queryable.
        </p>
      </section>
      <EmptyState marker="02" title="No scan records">
        Scan creation and worker execution are not part of this foundation
        layer. The schema and typed lifecycle are ready for that integration.
      </EmptyState>
    </div>
  );
}
