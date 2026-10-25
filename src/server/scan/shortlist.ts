import { Prisma, type PrismaClient } from "@prisma/client";

// The shortlist surface renders the newest shippable report's current rolodex
// decisions. It never reads the execution snapshots or the report body, and
// memorySnapshot alone holds every non-merged candidate in the workspace, so a
// default include would stream megabytes of audit JSON into the landing page.
export const shortlistScanSelect = {
  id: true,
  runDate: true,
  shortlistCount: true,
  parkingCount: true,
  evaluatorViolations: {
    orderBy: { createdAt: "asc" as const },
    select: { id: true },
  },
  candidates: {
    where: {
      placement: "SHORTLIST" as const,
      candidate: { doNotResurface: false, notForSurfacing: false },
    },
    orderBy: [{ rank: "asc" as const }],
    select: {
      id: true,
      rank: true,
      hook: true,
      whyNow: true,
      rationale: true,
      caveat: true,
      sensitivity: true,
      overallScore: true,
      protagonistScore: true,
      visibleHookScore: true,
      candidate: {
        select: {
          id: true,
          name: true,
          handle: true,
          project: true,
          status: true,
          version: true,
          doNotResurface: true,
          provenance: {
            orderBy: { lastSeenAt: "desc" as const },
            take: 1,
            select: {
              id: true,
              sourceUrl: true,
              source: { select: { displayName: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ScanSelect;

export type ShortlistScan = Prisma.ScanGetPayload<{
  select: typeof shortlistScanSelect;
}>;

export function loadLatestShippableScan(
  database: PrismaClient,
  workspaceId: string,
): Promise<ShortlistScan | null> {
  return database.scan.findFirst({
    where: { workspaceId, status: "COMPLETED", evalPassed: true },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: shortlistScanSelect,
  });
}
