import { AccessState } from "@/components/access-state";
import { PageHeading } from "@/components/page-heading";
import { TuningEditor } from "@/app/tuning/tuning-editor";
import { prisma } from "@/server/db";
import { resolvePageAccess } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tuning" };

export default async function TuningPage() {
  const access = await resolvePageAccess();
  if (access.state !== "authenticated") {
    return <div className="page-stack"><AccessState access={access} /></div>;
  }
  const config = await prisma.tuningConfig.findUnique({
    where: { workspaceId: access.principal.workspaceId },
    include: {
      activeRevision: { include: { items: { orderBy: { position: "asc" } } } },
      revisions: {
        orderBy: { revision: "desc" },
        include: {
          createdBy: { select: { displayName: true } },
          items: { orderBy: { position: "asc" } },
        },
      },
    },
  });
  const revision = config?.activeRevision;
  const splitItems = (items: NonNullable<typeof revision>["items"] | undefined, kind: "HARD_NO" | "MORE_OF") =>
    items?.filter((item) => item.kind === kind).map((item) => item.value) ?? [];
  return (
    <div className="page-stack">
      <PageHeading eyebrow="Editorial configuration" title="Tuning" description="Edit operational focus, preview the exact Python-generated prompt, and preserve every immutable revision." />
      <TuningEditor
        initial={{
          version: config?.version ?? 1,
          beat: revision?.beat ?? "Open-ended stories with a visible human journey.",
          hardNos: splitItems(revision?.items, "HARD_NO"),
          moreOf: splitItems(revision?.items, "MORE_OF"),
        }}
        revisions={config?.revisions.map((item) => ({
          id: item.id,
          revision: item.revision,
          beat: item.beat,
          createdAt: item.createdAt.toISOString(),
          createdBy: item.createdBy,
          hardNos: splitItems(item.items, "HARD_NO"),
          moreOf: splitItems(item.items, "MORE_OF"),
        })) ?? []}
      />
    </div>
  );
}
