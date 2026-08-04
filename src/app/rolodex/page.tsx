import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";

export const metadata = { title: "Rolodex" };

export default function RolodexPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Persistent memory"
        title="Rolodex"
        description="Durable candidate identity, provenance, statuses, tags, and authored notes."
      />
      <section className="filter-bar" aria-label="Candidate filters">
        <label>
          <span className="sr-only">Search candidates</span>
          <input disabled placeholder="Search people, handles, or projects" />
        </label>
        <select disabled aria-label="Status filter" defaultValue="">
          <option value="">All statuses</option>
        </select>
        <select disabled aria-label="Tag filter" defaultValue="">
          <option value="">All tags</option>
        </select>
      </section>
      <section className="table-card">
        <div className="table-header">
          <span>Candidate</span>
          <span>Status</span>
          <span>Source</span>
          <span>Last seen</span>
        </div>
        <div className="table-preview" aria-hidden="true">
          <span>Example shape</span>
          <StatusBadge status="NEW" />
          <span>Normalized provenance</span>
          <span>Timestamped</span>
        </div>
      </section>
      <EmptyState marker="03" title="The rolodex is ready to compound">
        Use the markdown memory importer to bootstrap existing
        do-not-resurface and taste-log records before API writes are enabled.
      </EmptyState>
    </div>
  );
}
