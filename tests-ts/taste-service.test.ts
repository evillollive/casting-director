import { describe, expect, it, vi } from "vitest";
import {
  createTasteLogEntry,
  listTasteLog,
  TasteLogVersionConflictError,
  updateTasteLogEntry,
} from "@/server/taste/service";

const principal = {
  userId: "user-1",
  workspaceId: "workspace-1",
  role: "MEMBER" as const,
};

function transactionDatabase(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(
      async (callback: (value: unknown) => unknown) => callback(tx),
    ),
  } as never;
}

describe("taste-log service", () => {
  it("lists workspace entries newest first with cursor pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "taste-2" },
      { id: "taste-1" },
    ]);
    const database = {
      tasteLogEntry: { findMany, findFirst: vi.fn() },
    } as never;
    const page = await listTasteLog(database, "workspace-1", { limit: 1 });

    expect(page.items).toEqual([{ id: "taste-2" }]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace-1" },
        orderBy: [
          { weekOf: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: 2,
      }),
    );
  });

  it("creates the first authored audit revision with the entry", async () => {
    const tx = {
      tasteLogEntry: {
        create: vi.fn().mockResolvedValue({ id: "taste-1", version: 1 }),
      },
    };
    await createTasteLogEntry(transactionDatabase(tx), principal, {
      weekOf: "2026-08-03",
      note: "Loved the surprising technical specificity.",
    });
    expect(tx.tasteLogEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          workspaceId: "workspace-1",
          weekOf: new Date("2026-08-03T00:00:00.000Z"),
          note: "Loved the surprising technical specificity.",
          createdById: "user-1",
          updatedById: "user-1",
          revisions: {
            create: {
              revision: 1,
              note: "Loved the surprising technical specificity.",
              editedById: "user-1",
            },
          },
        },
      }),
    );
  });

  it("uses a workspace/version conditional update before appending an audit", async () => {
    const tx = {
      tasteLogEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: "taste-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "taste-1",
          version: 3,
        }),
      },
      tasteLogEntryRevision: { create: vi.fn() },
    };
    await updateTasteLogEntry(
      transactionDatabase(tx),
      principal,
      "taste-1",
      { version: 2, note: "Sharper observation." },
    );
    expect(tx.tasteLogEntry.updateMany).toHaveBeenCalledWith({
      where: {
        id: "taste-1",
        workspaceId: "workspace-1",
        version: 2,
      },
      data: {
        note: "Sharper observation.",
        updatedById: "user-1",
        version: { increment: 1 },
      },
    });
    expect(tx.tasteLogEntryRevision.create).toHaveBeenCalledWith({
      data: {
        tasteLogEntryId: "taste-1",
        revision: 3,
        note: "Sharper observation.",
        editedById: "user-1",
      },
    });
  });

  it("does not append an audit when optimistic concurrency fails", async () => {
    const tx = {
      tasteLogEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: "taste-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      tasteLogEntryRevision: { create: vi.fn() },
    };
    await expect(
      updateTasteLogEntry(
        transactionDatabase(tx),
        principal,
        "taste-1",
        { version: 2, note: "Stale edit." },
      ),
    ).rejects.toBeInstanceOf(TasteLogVersionConflictError);
    expect(tx.tasteLogEntryRevision.create).not.toHaveBeenCalled();
  });
});
