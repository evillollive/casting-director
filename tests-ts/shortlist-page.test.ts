import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  loadLatestShippableScan,
  shortlistScanSelect,
} from "@/server/scan/shortlist";

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

describe("shortlist scan query", () => {
  it("never selects the large audit snapshot columns", async () => {
    const { database, findFirst } = databaseReturning(null);
    await loadLatestShippableScan(database, "workspace-1");

    const call = findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.include).toBeUndefined();
    const select = call.select as Record<string, unknown>;
    expect(select).toBeDefined();
    for (const column of AUDIT_SNAPSHOT_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
  });

  it("projects only the candidate columns the shortlist renders", () => {
    const candidate = shortlistScanSelect.candidates.select.candidate.select;
    expect(candidate).toMatchObject({
      id: true,
      name: true,
      handle: true,
      project: true,
      status: true,
      version: true,
      doNotResurface: true,
    });
    expect(candidate).not.toHaveProperty("rationale");
    expect(candidate).not.toHaveProperty("fingerprint");
    expect(candidate.provenance.take).toBe(1);
    expect(candidate.provenance.select.source.select).toEqual({
      displayName: true,
    });
  });

  it("restricts the latest scan to shippable completed runs", async () => {
    const { database, findFirst } = databaseReturning(null);
    await loadLatestShippableScan(database, "workspace-1");

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
  });

  it("keeps surfacing-eligible shortlist placements in rank order", () => {
    expect(shortlistScanSelect.candidates.where).toEqual({
      placement: "SHORTLIST",
      candidate: { doNotResurface: false, notForSurfacing: false },
    });
    expect(shortlistScanSelect.candidates.orderBy).toEqual([{ rank: "asc" }]);
  });
});
