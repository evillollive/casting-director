import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { listScans } from "@/server/scan/service";

const AUDIT_SNAPSHOT_COLUMNS = [
  "promptSnapshot",
  "configSnapshot",
  "tuningSnapshot",
  "tasteLogSnapshot",
  "memorySnapshot",
  "doNotResurfaceSnapshot",
  "reportMarkdown",
] as const;

function scanRow(id: string) {
  return {
    id,
    status: "COMPLETED",
    runDate: new Date("2026-01-05T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    candidatesFetched: 12,
    candidatesDeduped: 10,
    candidatesScreened: 8,
    shortlistCount: 3,
    parkingCount: 2,
    summary: "weekly",
    error: null,
    evalPassed: true,
    sources: [],
    evaluatorViolations: [],
    job: null,
  };
}

function databaseReturning(scans: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(scans);
  return {
    database: { scan: { findMany } } as unknown as PrismaClient,
    findMany,
  };
}

describe("scan list", () => {
  it("never selects the large audit snapshot columns", async () => {
    const { database, findMany } = databaseReturning([scanRow("scan-1")]);
    await listScans(database, "workspace-1", { limit: 25 });

    const call = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.include).toBeUndefined();
    const select = call.select as Record<string, unknown> | undefined;
    expect(select).toBeDefined();
    for (const column of AUDIT_SNAPSHOT_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
    expect(select).toMatchObject({
      id: true,
      status: true,
      summary: true,
      evalPassed: true,
    });
    expect(select).toHaveProperty("sources");
    expect(select).toHaveProperty("evaluatorViolations");
    expect(select).toHaveProperty("job");
  });

  it("still returns projected rows, progress, and pagination", async () => {
    const rows = [scanRow("scan-1"), scanRow("scan-2")];
    const { database } = databaseReturning(rows);
    const result = await listScans(database, "workspace-1", { limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "scan-1",
      candidatesFetched: 12,
      shortlistCount: 3,
      shippable: true,
    });
    expect(result.items[0]?.sourceProgress).toEqual([]);
    expect(result.nextCursor).toBe("scan-1");
  });
});
