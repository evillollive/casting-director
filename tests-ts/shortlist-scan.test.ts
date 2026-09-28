import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getShortlistScan } from "@/server/scan/service";

const AUDIT_SNAPSHOT_COLUMNS = [
  "promptSnapshot",
  "configSnapshot",
  "tuningSnapshot",
  "tasteLogSnapshot",
  "memorySnapshot",
  "doNotResurfaceSnapshot",
  "reportMarkdown",
] as const;

function databaseReturning(scan: unknown) {
  const findFirst = vi.fn().mockResolvedValue(scan);
  return {
    database: { scan: { findFirst } } as unknown as PrismaClient,
    findFirst,
  };
}

describe("shortlist scan", () => {
  it("never selects the large audit snapshot columns", async () => {
    const { database, findFirst } = databaseReturning(null);
    await getShortlistScan(database, "workspace-1");

    const call = findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.include).toBeUndefined();
    const select = call.select as Record<string, unknown>;
    expect(select).toBeDefined();
    for (const column of AUDIT_SNAPSHOT_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
  });

  it("counts evaluator violations instead of loading their rows", async () => {
    const { database, findFirst } = databaseReturning(null);
    await getShortlistScan(database, "workspace-1");

    const select = (findFirst.mock.calls[0]?.[0] as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(select).not.toHaveProperty("evaluatorViolations");
    expect(select._count).toEqual({ select: { evaluatorViolations: true } });
  });

  it("projects appearances without per-appearance model metadata", async () => {
    const { database, findFirst } = databaseReturning(null);
    await getShortlistScan(database, "workspace-1");

    const select = (findFirst.mock.calls[0]?.[0] as Record<string, unknown>)
      .select as Record<string, unknown>;
    const candidates = select.candidates as Record<string, unknown>;
    const appearance = candidates.select as Record<string, unknown>;
    expect(appearance).not.toHaveProperty("modelMetadata");
    expect(appearance).toMatchObject({
      id: true,
      rank: true,
      hook: true,
      overallScore: true,
      protagonistScore: true,
      visibleHookScore: true,
    });

    const candidate = (appearance.candidate as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(candidate).toMatchObject({
      id: true,
      name: true,
      status: true,
      version: true,
      doNotResurface: true,
    });
    const provenance = candidate.provenance as Record<string, unknown>;
    expect(provenance.take).toBe(1);
    expect(provenance.select).toEqual({
      id: true,
      sourceUrl: true,
      source: { select: { displayName: true } },
    });
  });

  it("still filters to the newest shippable scan and eligible appearances", async () => {
    const { database, findFirst } = databaseReturning(null);
    await getShortlistScan(database, "workspace-1");

    const call = findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.where).toEqual({
      workspaceId: "workspace-1",
      status: "COMPLETED",
      evalPassed: true,
    });
    expect(call.orderBy).toEqual([
      { completedAt: "desc" },
      { createdAt: "desc" },
    ]);

    const select = call.select as Record<string, unknown>;
    const candidates = select.candidates as Record<string, unknown>;
    expect(candidates.where).toEqual({
      placement: "SHORTLIST",
      candidate: { doNotResurface: false, notForSurfacing: false },
    });
    expect(candidates.orderBy).toEqual({ rank: "asc" });
  });
});
