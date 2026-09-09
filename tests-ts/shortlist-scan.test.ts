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

function shortlistQuery() {
  const { database, findFirst } = databaseReturning(null);
  return { database, findFirst };
}

describe("shortlist scan query", () => {
  it("never selects the large audit snapshot columns", async () => {
    const { database, findFirst } = shortlistQuery();
    await getShortlistScan(database, "workspace-1");

    const call = findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.include).toBeUndefined();
    const select = call.select as Record<string, unknown> | undefined;
    expect(select).toBeDefined();
    for (const column of AUDIT_SNAPSHOT_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
    expect(select).toMatchObject({
      id: true,
      runDate: true,
      shortlistCount: true,
      parkingCount: true,
    });
  });

  it("counts evaluator findings instead of loading every violation row", async () => {
    const { database, findFirst } = shortlistQuery();
    await getShortlistScan(database, "workspace-1");

    const select = (findFirst.mock.calls[0]?.[0] as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(select).not.toHaveProperty("evaluatorViolations");
    expect(select._count).toEqual({ select: { evaluatorViolations: true } });
  });

  it("projects only the candidate columns the shortlist renders", async () => {
    const { database, findFirst } = shortlistQuery();
    await getShortlistScan(database, "workspace-1");

    const select = (findFirst.mock.calls[0]?.[0] as Record<string, unknown>)
      .select as Record<string, Record<string, unknown>>;
    const candidateSelect = select.candidates.select as Record<string, unknown>;
    const candidate = (candidateSelect.candidate as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(candidate).toMatchObject({
      id: true,
      name: true,
      status: true,
      version: true,
      doNotResurface: true,
    });
    expect(candidate).not.toHaveProperty("fingerprint");
    expect(candidate).not.toHaveProperty("rationale");
    const provenance = (candidate.provenance as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(provenance).toEqual({
      sourceUrl: true,
      source: { select: { displayName: true } },
    });
  });

  it("still filters to the newest evaluator-clean completed scan", async () => {
    const { database, findFirst } = shortlistQuery();
    await getShortlistScan(database, "workspace-9");

    const call = findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.where).toEqual({
      workspaceId: "workspace-9",
      status: "COMPLETED",
      evalPassed: true,
    });
    expect(call.orderBy).toEqual([
      { completedAt: "desc" },
      { createdAt: "desc" },
    ]);
  });
});
