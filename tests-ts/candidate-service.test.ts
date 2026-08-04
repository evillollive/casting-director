import { describe, expect, it, vi } from "vitest";
import {
  bulkUpdateCandidates,
  CandidateNotFoundError,
  CandidateVersionConflictError,
  listCandidates,
  updateCandidate,
} from "@/server/candidate/service";

const principal = {
  userId: "user-1",
  workspaceId: "workspace-1",
  role: "MEMBER" as const,
};

function transactionDatabase(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    ),
  } as never;
}

describe("candidate service", () => {
  it("builds workspace-scoped filter queries and stable cursor pagination", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "candidate-2",
          overallScore: 5,
          name: "Ada",
          updatedAt: new Date("2026-08-04T20:00:00Z"),
        },
        {
          id: "candidate-1",
          overallScore: 4,
          name: "Ada Two",
          updatedAt: new Date("2026-08-03T20:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "candidate-1",
          overallScore: 4,
          name: "Ada Two",
          updatedAt: new Date("2026-08-03T20:00:00Z"),
        },
      ]);
    const database = { candidate: { findMany } } as never;
    const query = {
      limit: 1,
      query: "Ada",
      status: "NEW" as const,
      tag: "founder",
      sourceFamily: "CODE_HOST" as const,
      region: "Europe",
      minimumOverallScore: 4,
      isEvergreen: true,
      gatePassed: false,
      doNotResurface: false,
      notForSurfacing: false,
      sort: "score" as const,
      direction: "desc" as const,
    };

    const firstPage = await listCandidates(database, "workspace-1", query);
    expect(firstPage.items).toEqual([
      expect.objectContaining({ id: "candidate-2" }),
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "workspace-1",
          mergedIntoId: null,
          status: "NEW",
          region: { contains: "Europe", mode: "insensitive" },
          overallScore: { gte: 4 },
          isEvergreen: true,
          gatePassed: false,
          doNotResurface: false,
          notForSurfacing: false,
          tags: {
            some: {
              tag: {
                OR: [
                  { id: "founder" },
                  { slug: "founder" },
                  {
                    name: { equals: "founder", mode: "insensitive" },
                  },
                ],
              },
            },
          },
          provenance: { some: { source: { family: "CODE_HOST" } } },
        }),
        orderBy: [
          { overallScore: { sort: "desc", nulls: "last" } },
          { id: "desc" },
        ],
        take: 2,
      }),
    );

    await listCandidates(database, "workspace-1", {
      ...query,
      cursor: firstPage.nextCursor!,
    });
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              workspaceId: "workspace-1",
              status: "NEW",
            }),
            {
              OR: [
                { overallScore: { lt: 5 } },
                { overallScore: 5, id: { lt: "candidate-2" } },
                { overallScore: null },
              ],
            },
          ],
        },
      }),
    );
  });

  it("conditionally updates a candidate and appends authored notes and status audit", async () => {
    const tx = {
      candidate: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: "candidate-1", status: "NEW" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "candidate-1" }),
      },
      tag: {
        findMany: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
      },
      candidateTag: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      candidateNote: { create: vi.fn() },
      candidateStatusChange: { create: vi.fn() },
    };

    await updateCandidate(
      transactionDatabase(tx),
      principal,
      "candidate-1",
      {
        version: 3,
        status: "CONTACTED",
        tagIds: ["tag-1"],
        note: "Strong follow-up.",
      },
    );

    expect(tx.candidate.updateMany).toHaveBeenCalledWith({
      where: {
        id: "candidate-1",
        workspaceId: "workspace-1",
        version: 3,
      },
      data: expect.objectContaining({
        status: "CONTACTED",
        version: { increment: 1 },
      }),
    });
    expect(tx.candidateNote.create).toHaveBeenCalledWith({
      data: {
        candidateId: "candidate-1",
        authorId: "user-1",
        body: "Strong follow-up.",
      },
    });
    expect(tx.candidateStatusChange.create).toHaveBeenCalledWith({
      data: {
        candidateId: "candidate-1",
        authorId: "user-1",
        fromStatus: "NEW",
        toStatus: "CONTACTED",
      },
    });
    expect(tx.tag.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", id: { in: ["tag-1"] } },
      select: { id: true },
    });
  });

  it("does not append history when the conditional version update loses", async () => {
    const tx = {
      candidate: {
        findFirst: vi.fn().mockResolvedValue({ id: "candidate-1", status: "NEW" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      tag: { findMany: vi.fn() },
      candidateTag: { deleteMany: vi.fn(), createMany: vi.fn() },
      candidateNote: { create: vi.fn() },
      candidateStatusChange: { create: vi.fn() },
    };

    await expect(
      updateCandidate(transactionDatabase(tx), principal, "candidate-1", {
        version: 2,
        note: "Losing edit",
      }),
    ).rejects.toBeInstanceOf(CandidateVersionConflictError);
    expect(tx.candidateNote.create).not.toHaveBeenCalled();
    expect(tx.candidateStatusChange.create).not.toHaveBeenCalled();
  });

  it("refuses a partial bulk selection before performing any write", async () => {
    const tx = {
      candidate: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "candidate-1", status: "NEW" }]),
        updateMany: vi.fn(),
      },
      tag: { findMany: vi.fn() },
      candidateTag: { deleteMany: vi.fn(), createMany: vi.fn() },
      candidateStatusChange: { createMany: vi.fn() },
    };

    await expect(
      bulkUpdateCandidates(transactionDatabase(tx), principal, {
        candidateIds: ["candidate-1", "candidate-outside"],
        doNotResurface: true,
      }),
    ).rejects.toBeInstanceOf(CandidateNotFoundError);
    expect(tx.candidate.updateMany).not.toHaveBeenCalled();
    expect(tx.candidateTag.deleteMany).not.toHaveBeenCalled();
  });

  it("applies explicit bulk changes atomically within the principal workspace", async () => {
    const tx = {
      candidate: {
        findMany: vi.fn().mockResolvedValue([
          { id: "candidate-1", status: "NEW", version: 1 },
          { id: "candidate-2", status: "CONTACTED", version: 3 },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      tag: { findMany: vi.fn().mockResolvedValue([{ id: "tag-1" }]) },
      candidateTag: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      candidateStatusChange: { createMany: vi.fn() },
      repositorySyncJob: { createMany: vi.fn() },
    };

    await expect(
      bulkUpdateCandidates(transactionDatabase(tx), principal, {
        candidateIds: ["candidate-1", "candidate-2"],
        status: "CONTACTED",
        tagIds: ["tag-1"],
        doNotResurface: true,
      }),
    ).resolves.toEqual({ updatedCount: 2 });
    expect(tx.candidate.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        id: { in: ["candidate-1", "candidate-2"] },
      },
      data: expect.objectContaining({
        status: "CONTACTED",
        doNotResurface: true,
        version: { increment: 1 },
      }),
    });
    expect(tx.candidateStatusChange.createMany).toHaveBeenCalledWith({
      data: [
        {
          candidateId: "candidate-1",
          authorId: "user-1",
          fromStatus: "NEW",
          toStatus: "CONTACTED",
        },
      ],
    });
  });
});
