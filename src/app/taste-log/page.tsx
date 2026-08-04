import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";

export const metadata = { title: "Taste log" };

export default function TasteLogPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Calibration memory"
        title="Taste log"
        description="Dated observations are newest-first, revisioned, and exportable to the canonical markdown shape."
        action={
          <button className="primary-button" disabled>
            Add observation
          </button>
        }
      />
      <EmptyState marker="04" title="No observations imported">
        Run the markdown importer in dry-run mode to preview existing weekly
        taste observations before writing them to Postgres.
      </EmptyState>
    </div>
  );
}
