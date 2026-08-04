import { Prisma, type CandidateStatus, type SourceFamily } from "@prisma/client";
import type { Route } from "next";
import Link from "next/link";
import { AccessState } from "@/components/access-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { RolodexTable } from "@/app/rolodex/rolodex-table";
import { SyncPanel } from "@/app/rolodex/sync-panel";
import { prisma } from "@/server/db";
import { resolvePageAccess } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rolodex" };

type SearchParameters = Record<string, string | string[] | undefined>;
const pageSize = 25;

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function RolodexPage({ searchParams }: { searchParams: Promise<SearchParameters> }) {
  const access = await resolvePageAccess();
  if (access.state !== "authenticated") {
    return <div className="page-stack"><AccessState access={access} /></div>;
  }
  const parameters = await searchParams;
  const query = single(parameters.query).trim();
  const status = single(parameters.status) as CandidateStatus | "";
  const tag = single(parameters.tag);
  const sourceFamily = single(parameters.sourceFamily) as SourceFamily | "";
  const region = single(parameters.region).trim();
  const sort = single(parameters.sort) || "updated";
  const page = Math.max(1, Number(single(parameters.page)) || 1);
  const where: Prisma.CandidateWhereInput = {
    workspaceId: access.principal.workspaceId,
    mergedIntoId: null,
    ...(query ? {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { handle: { contains: query, mode: "insensitive" } },
        { project: { contains: query, mode: "insensitive" } },
        { hook: { contains: query, mode: "insensitive" } },
      ],
    } : {}),
    ...(status ? { status } : {}),
    ...(tag ? { tags: { some: { tag: { slug: tag } } } } : {}),
    ...(sourceFamily ? { provenance: { some: { source: { family: sourceFamily } } } } : {}),
    ...(region ? { region: { contains: region, mode: "insensitive" } } : {}),
  };
  const orderBy: Prisma.CandidateOrderByWithRelationInput[] =
    sort === "score"
      ? [
          { overallScore: { sort: "desc", nulls: "last" } },
          { updatedAt: "desc" },
          { id: "desc" },
        ]
      : sort === "name"
        ? [{ name: "asc" }, { id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "desc" }];
  const [items, total, tags, conflicts] = await Promise.all([
    prisma.candidate.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        tags: { include: { tag: true }, orderBy: { tag: { name: "asc" } } },
        notes: { include: { author: { select: { displayName: true } } }, orderBy: { createdAt: "desc" } },
        provenance: { include: { source: true }, orderBy: { lastSeenAt: "desc" } },
      },
    }),
    prisma.candidate.count({ where }),
    prisma.tag.findMany({
      where: { workspaceId: access.principal.workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    prisma.markdownSyncConflict.findMany({
      where: {
        syncState: { workspaceId: access.principal.workspaceId },
        status: "OPEN",
      },
      select: {
        id: true,
        normalizedIdentity: true,
        databaseSnapshot: true,
        markdownSnapshot: true,
        version: true,
        syncState: { select: { document: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const serializedItems = items.map((item) => ({
    ...item,
    firstSeenAt: item.firstSeenAt.toISOString(),
    lastSeenAt: item.lastSeenAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    tags: item.tags.map(({ tag: itemTag }) => ({
      tag: { id: itemTag.id, name: itemTag.name },
    })),
    notes: item.notes.map((note) => ({ ...note, createdAt: note.createdAt.toISOString() })),
    provenance: item.provenance.map((provenance) => ({
      ...provenance,
      firstSeenAt: provenance.firstSeenAt.toISOString(),
      lastSeenAt: provenance.lastSeenAt.toISOString(),
      createdAt: provenance.createdAt.toISOString(),
      updatedAt: provenance.updatedAt.toISOString(),
    })),
  }));
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) if (typeof value === "string" && key !== "page" && value) next.set(key, value);
    next.set("page", String(nextPage));
    return `/rolodex?${next.toString()}` as Route;
  };

  return (
    <div className="page-stack">
      <PageHeading eyebrow="Persistent memory" title="Rolodex" description="Search, filter, sort, and update durable candidate identity, provenance, status, tags, and authored context." />
      <SyncPanel initialConflicts={conflicts} />
      <form className="filter-bar rolodex-filters">
        <label><span className="sr-only">Search candidates</span><input name="query" defaultValue={query} placeholder="Search people, handles, projects, or hooks" /></label>
        <label><span className="sr-only">Status filter</span><select name="status" defaultValue={status}><option value="">All statuses</option>{["NEW", "CONTACTED", "PASSED", "CAST", "MAYBE_LATER"].map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label>
        <label><span className="sr-only">Tag filter</span><select name="tag" defaultValue={tag}><option value="">All tags</option>{tags.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
        <label><span className="sr-only">Source family filter</span><select name="sourceFamily" defaultValue={sourceFamily}><option value="">All source families</option>{["NEWS", "CODE_HOST", "COMMUNITY", "MAKER", "GAMES", "VIDEO", "SOCIAL", "SCIENCE", "CIVIC", "ACCESSIBILITY", "OTHER"].map((item) => <option key={item}>{item.replace("_", " ")}</option>)}</select></label>
        <label><span className="sr-only">Region filter</span><input name="region" defaultValue={region} placeholder="Region" /></label>
        <label><span className="sr-only">Sort candidates</span><select name="sort" defaultValue={sort}><option value="updated">Recently updated</option><option value="score">Highest score</option><option value="name">Name</option></select></label>
        <button className="secondary-button" type="submit">Apply</button>
      </form>
      {items.length === 0 ? (
        <EmptyState marker="03" title="No candidates match">Adjust the filters or run a scan to populate the workspace.</EmptyState>
      ) : (
        <RolodexTable items={serializedItems} availableTags={tags} />
      )}
      <nav className="pagination" aria-label="Candidate pages">
        {page > 1 ? <Link className="secondary-button" href={pageHref(page - 1)}>Previous</Link> : <span />}
        <span>Page {page} of {pageCount} · {total} candidates</span>
        {page < pageCount ? <Link className="secondary-button" href={pageHref(page + 1)}>Next</Link> : <span />}
      </nav>
    </div>
  );
}
