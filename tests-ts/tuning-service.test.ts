import { describe, expect, it, vi } from "vitest";
import {
  TuningVersionConflictError,
  updateTuning,
} from "@/server/tuning/service";

const principal = {
  userId: "user-1",
  workspaceId: "workspace-1",
  role: "ADMIN" as const,
};

function transactionDatabase(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(
      async (callback: (value: unknown) => unknown) => callback(tx),
    ),
  } as never;
}

describe("tuning service", () => {
  it("creates and finalizes a new immutable revision before conditional activation", async () => {
    const actor = {
      id: "user-1",
      displayName: "Editor",
      email: "editor@example.com",
    };
    const activeRevision = {
      id: "revision-3",
      revision: 3,
      beat: "Humans building unusual public tools",
      createdById: "user-1",
      createdAt: new Date("2026-08-04T20:00:00Z"),
      finalizedAt: new Date("2026-08-04T20:00:01Z"),
      items: [
        {
          id: "item-1",
          tuningRevisionId: "revision-3",
          kind: "HARD_NO",
          position: 0,
          value: "Pure funding news",
        },
      ],
      createdBy: actor,
    };
    const tx = {
      tuningConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "config-1",
          version: 7,
          revisions: [{ revision: 2 }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "config-1",
          workspaceId: "workspace-1",
          activeRevisionId: "revision-3",
          createdById: "user-1",
          updatedById: "user-1",
          createdAt: new Date("2026-08-01T20:00:00Z"),
          updatedAt: new Date("2026-08-04T20:00:01Z"),
          version: 8,
          activeRevision,
          revisions: [activeRevision],
          createdBy: actor,
          updatedBy: actor,
        }),
      },
      tuningConfigRevision: {
        create: vi.fn().mockResolvedValue({ id: "revision-3" }),
        update: vi.fn(),
      },
    };

    const result = await updateTuning(
      transactionDatabase(tx),
      principal,
      {
        version: 7,
        beat: "Humans building unusual public tools",
        hardNos: ["Pure funding news"],
        moreOf: ["Distinctive voices"],
      },
    );

    expect(tx.tuningConfigRevision.create).toHaveBeenCalledWith({
      data: {
        tuningConfigId: "config-1",
        revision: 3,
        beat: "Humans building unusual public tools",
        createdById: "user-1",
        items: {
          create: [
            { kind: "HARD_NO", position: 0, value: "Pure funding news" },
            { kind: "MORE_OF", position: 0, value: "Distinctive voices" },
          ],
        },
      },
    });
    expect(tx.tuningConfigRevision.update).toHaveBeenCalledWith({
      where: { id: "revision-3" },
      data: { finalizedAt: expect.any(Date) },
    });
    expect(tx.tuningConfig.updateMany).toHaveBeenCalledWith({
      where: { id: "config-1", version: 7 },
      data: {
        activeRevisionId: "revision-3",
        updatedById: "user-1",
        version: { increment: 1 },
      },
    });
    expect(result).toMatchObject({
      version: 8,
      active: { id: "revision-3", hardNos: ["Pure funding news"] },
      history: [{ id: "revision-3" }],
      metadata: { updatedBy: actor },
    });
  });

  it("rejects stale versions without creating a revision", async () => {
    const tx = {
      tuningConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "config-1",
          version: 8,
          revisions: [{ revision: 3 }],
        }),
      },
      tuningConfigRevision: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    await expect(
      updateTuning(transactionDatabase(tx), principal, {
        version: 7,
        beat: "Old edit",
        hardNos: [],
        moreOf: [],
      }),
    ).rejects.toBeInstanceOf(TuningVersionConflictError);
    expect(tx.tuningConfigRevision.create).not.toHaveBeenCalled();
  });
});
