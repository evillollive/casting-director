import { Prisma, type PrismaClient } from "@prisma/client";

export const ROLODEX_PAGE_SIZE = 25;

// The rolodex table renders identity, flags, tag names, note bodies, and source
// appearances — nothing else. `include` would fetch every candidate column plus
// whole provenance rows, and provenance carries `rawMetadata`, the raw scraped
// context the worker stores per source appearance (up to ~5KB each). None of it
// is rendered, but all of it would be serialized into the RSC payload for every
// row on the page, so the query projects exactly what the table consumes.
export const rolodexCandidateSelect = {
  id: true,
  name: true,
  handle: true,
  project: true,
  projectUrl: true,
  region: true,
  overallScore: true,
  status: true,
  doNotResurface: true,
  notForSurfacing: true,
  lastSeenAt: true,
  tags: {
    select: { tag: { select: { id: true, name: true } } },
    orderBy: { tag: { name: "asc" as const } },
  },
  notes: {
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  provenance: {
    select: {
      id: true,
      sourceUrl: true,
      firstSeenAt: true,
      lastSeenAt: true,
      source: { select: { displayName: true, family: true } },
    },
    orderBy: { lastSeenAt: "desc" as const },
  },
} satisfies Prisma.CandidateSelect;

type RolodexCandidate = Prisma.CandidateGetPayload<{
  select: typeof rolodexCandidateSelect;
}>;

export function serializeRolodexCandidate(candidate: RolodexCandidate) {
  return {
    ...candidate,
    lastSeenAt: candidate.lastSeenAt.toISOString(),
    notes: candidate.notes.map((note) => ({
      ...note,
      createdAt: note.createdAt.toISOString(),
    })),
    provenance: candidate.provenance.map((provenance) => ({
      ...provenance,
      firstSeenAt: provenance.firstSeenAt.toISOString(),
      lastSeenAt: provenance.lastSeenAt.toISOString(),
    })),
  };
}

export async function listRolodexCandidates(
  database: PrismaClient,
  input: {
    where: Prisma.CandidateWhereInput;
    orderBy: Prisma.CandidateOrderByWithRelationInput[];
    page: number;
    pageSize?: number;
  },
) {
  const pageSize = input.pageSize ?? ROLODEX_PAGE_SIZE;
  const [items, total] = await Promise.all([
    database.candidate.findMany({
      where: input.where,
      orderBy: input.orderBy,
      skip: (input.page - 1) * pageSize,
      take: pageSize,
      select: rolodexCandidateSelect,
    }),
    database.candidate.count({ where: input.where }),
  ]);
  return {
    items: items.map(serializeRolodexCandidate),
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
