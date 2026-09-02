import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ROLODEX_PAGE_SIZE,
  listRolodexCandidates,
  rolodexCandidateSelect,
} from "@/server/candidate/rolodex";

function candidateRow(id: string) {
  return {
    id,
    name: "Ada",
    handle: "ada",
    project: "analytical-engine",
    projectUrl: "https://example.test/ada",
    region: "UK",
    overallScore: 4,
    status: "NEW",
    doNotResurface: false,
    notForSurfacing: false,
    lastSeenAt: new Date("2026-01-05T00:00:00.000Z"),
    tags: [{ tag: { id: "tag-1", name: "Maker" } }],
    notes: [
      {
        id: "note-1",
        body: "Good fit.",
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        author: { displayName: "Editor" },
      },
    ],
    provenance: [
      {
        id: "prov-1",
        sourceUrl: "https://example.test/source",
        firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-01-03T00:00:00.000Z"),
        source: { displayName: "GitHub", family: "CODE_HOST" },
      },
    ],
  };
}

function databaseReturning(rows: unknown[], total: number) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(total);
  return {
    database: { candidate: { findMany, count } } as unknown as PrismaClient,
    findMany,
    count,
  };
}

describe("rolodex candidate page query", () => {
  it("projects only the columns the rolodex table renders", () => {
    // `rawMetadata` is the raw scraped source context the worker persists per
    // provenance row. It is never rendered, and an `include` would ship it to
    // the browser for every source appearance on the page.
    expect(rolodexCandidateSelect.provenance.select).not.toHaveProperty(
      "rawMetadata",
    );
    expect(Object.keys(rolodexCandidateSelect.provenance.select).sort()).toEqual(
      ["firstSeenAt", "id", "lastSeenAt", "source", "sourceUrl"],
    );
    expect(Object.keys(rolodexCandidateSelect.provenance.select.source.select)).toEqual([
      "displayName",
      "family",
    ]);
    for (const column of ["hook", "rationale", "voice", "arc", "fingerprint"]) {
      expect(rolodexCandidateSelect).not.toHaveProperty(column);
    }
  });

  it("selects rather than includes, and paginates and counts in one round trip", async () => {
    const { database, findMany, count } = databaseReturning(
      [candidateRow("candidate-1")],
      51,
    );
    const where = { workspaceId: "workspace-1" };
    const result = await listRolodexCandidates(database, {
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      page: 3,
    });

    const query = findMany.mock.calls[0]![0]!;
    expect(query.include).toBeUndefined();
    expect(query.select).toBe(rolodexCandidateSelect);
    expect(query.skip).toBe(2 * ROLODEX_PAGE_SIZE);
    expect(query.take).toBe(ROLODEX_PAGE_SIZE);
    expect(count).toHaveBeenCalledWith({ where });
    expect(result.total).toBe(51);
    expect(result.pageCount).toBe(3);
  });

  it("serializes every date the client component reads as an ISO string", async () => {
    const { database } = databaseReturning([candidateRow("candidate-1")], 1);
    const { items } = await listRolodexCandidates(database, {
      where: {},
      orderBy: [{ name: "asc" }],
      page: 1,
    });

    const [candidate] = items;
    expect(candidate!.lastSeenAt).toBe("2026-01-05T00:00:00.000Z");
    expect(candidate!.notes[0]!.createdAt).toBe("2026-01-04T00:00:00.000Z");
    expect(candidate!.provenance[0]!.firstSeenAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(candidate!.provenance[0]!.lastSeenAt).toBe(
      "2026-01-03T00:00:00.000Z",
    );
  });

  it("reports at least one page when the workspace has no candidates", async () => {
    const { database } = databaseReturning([], 0);
    const result = await listRolodexCandidates(database, {
      where: {},
      orderBy: [{ name: "asc" }],
      page: 1,
    });
    expect(result.items).toEqual([]);
    expect(result.pageCount).toBe(1);
  });
});
