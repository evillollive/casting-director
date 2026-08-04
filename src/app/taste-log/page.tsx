import { AccessState } from "@/components/access-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { TasteLogEditor } from "@/app/taste-log/taste-log-editor";
import { prisma } from "@/server/db";
import { resolvePageAccess } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Taste log" };

export default async function TasteLogPage() {
  const access = await resolvePageAccess();
  if (access.state !== "authenticated") {
    return <div className="page-stack"><AccessState access={access} /></div>;
  }
  const entries = await prisma.tasteLogEntry.findMany({
    where: { workspaceId: access.principal.workspaceId },
    orderBy: [{ weekOf: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      createdBy: { select: { displayName: true } },
      updatedBy: { select: { displayName: true } },
      revisions: {
        orderBy: { revision: "desc" },
        include: { editedBy: { select: { displayName: true } } },
      },
    },
  });
  const serialized = entries.map((entry) => ({
    ...entry,
    weekOf: entry.weekOf.toISOString().slice(0, 10),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    revisions: entry.revisions.map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  }));
  return (
    <div className="page-stack">
      <PageHeading eyebrow="Calibration memory" title="Taste log" description="Add dated observations and correct them without erasing authorship or immutable revision history." />
      {entries.length === 0 ? <EmptyState marker="04" title="No observations yet">The first entry will also feed the next canonical prompt preview and scan snapshot.</EmptyState> : null}
      <TasteLogEditor entries={serialized} />
    </div>
  );
}
