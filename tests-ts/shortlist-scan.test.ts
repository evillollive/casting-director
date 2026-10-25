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

async function shortlistCall() {
  const { database, findFirst } = databaseReturning(null);
  await getShortlistScan(database, "workspace-1");
  return findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("shortlist scan query", () => {
  it("never selects the large audit snapshot columns", async () => {
    const call = await shortlistCall();

    expect(call.include).toBeUndefined();
    const select = call.select as Record<string, unknown>;
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

  it("counts evaluator violations instead of loading every row", async () => {
    const select = (await shortlistCall()).select as Record<string, unknown>;

    expect(select).not.toHaveProperty("evaluatorViolations");
    expect(select._count).toEqual({ select: { evaluatorViolations: true } });
  });

  it("projects shortlist rows without raw provenance metadata", async () => {
    const select = (await shortlistCall()).select as Record<string, unknown>;
    const candidates = select.candidates as Record<string, unknown>;
    const appearance = candidates.select as Record<string, unknown>;

    expect(candidates.include).toBeUndefined();
    expect(appearance).not.toHaveProperty("modelMetadata");

    const candidate = (appearance.candidate as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(candidate).toMatchObject({ id: true, name: true, version: true });

    const provenance = (candidate.provenance as Record<string, unknown>)
      .select as Record<string, unknown>;
    expect(provenance).not.toHaveProperty("rawMetadata");
    expect(provenance).toMatchObject({ sourceUrl: true });
  });

  it("returns only the newest evaluator-clean completed scan", async () => {
    const call = await shortlistCall();

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
});
