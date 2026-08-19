import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getScan, ScanNotFoundError } from "@/server/scan/service";

const AUDIT_SNAPSHOT_COLUMNS = [
  "promptSnapshot",
  "configSnapshot",
  "tuningSnapshot",
  "tasteLogSnapshot",
  "memorySnapshot",
  "doNotResurfaceSnapshot",
] as const;

function databaseReturning(scan: unknown) {
  const findFirst = vi.fn().mockResolvedValue(scan);
  return {
    database: { scan: { findFirst } } as unknown as PrismaClient,
    findFirst,
  };
}

const completedScan = {
  id: "scan-1",
  status: "COMPLETED",
  evalPassed: true,
  reportMarkdown: "# report",
  candidatesFetched: 12,
  sources: [],
  evaluatorViolations: [],
  candidates: [],
  job: null,
};

describe("scan detail", () => {
  it("never selects the large audit snapshot columns", async () => {
    const { database, findFirst } = databaseReturning(completedScan);
    await getScan(database, "workspace-1", "scan-1");

    const select = findFirst.mock.calls[0]?.[0]?.select as
      | Record<string, unknown>
      | undefined;
    expect(select).toBeDefined();
    for (const column of AUDIT_SNAPSHOT_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
    expect(select).toMatchObject({
      id: true,
      status: true,
      promptHash: true,
      memoryHash: true,
      doNotResurfaceHash: true,
    });
  });

  it("still returns progress, counts, and the shippable report", async () => {
    const { database } = databaseReturning(completedScan);
    const scan = await getScan(database, "workspace-1", "scan-1");

    expect(scan.shippable).toBe(true);
    expect(scan.reportMarkdown).toBe("# report");
    expect(scan.diagnosticReportMarkdown).toBeNull();
    expect(scan.sourceProgress).toEqual([]);
    expect(scan.candidatesFetched).toBe(12);
  });

  it("withholds the report for a scan that is not shippable", async () => {
    const { database } = databaseReturning({
      ...completedScan,
      status: "FAILED",
      evalPassed: false,
    });
    const scan = await getScan(database, "workspace-1", "scan-1");

    expect(scan.shippable).toBe(false);
    expect(scan.reportMarkdown).toBeNull();
    expect(scan.diagnosticReportMarkdown).toBe("# report");
  });

  it("throws when the scan is not in the workspace", async () => {
    const { database } = databaseReturning(null);
    await expect(getScan(database, "workspace-1", "scan-1")).rejects.toThrow(
      ScanNotFoundError,
    );
  });
});
