import { describe, expect, it } from "vitest";
import {
  candidatePatchSchema,
  candidateQuerySchema,
  createScanSchema,
  scanQuerySchema,
} from "@/domain/api-contract";

describe("write API contracts", () => {
  it("requires optimistic concurrency on candidate writes", () => {
    expect(
      candidatePatchSchema.safeParse({ status: "CONTACTED" }).success,
    ).toBe(false);
    expect(
      candidatePatchSchema.safeParse({
        version: 4,
        status: "CONTACTED",
      }).success,
    ).toBe(true);
  });

  it("requires a dated scan and explicit source coverage", () => {
    expect(
      createScanSchema.safeParse({
        runDate: "2026-08-04",
        sourceKeys: ["hacker-news", "hackaday"],
      }).success,
    ).toBe(true);
    expect(
      createScanSchema.safeParse({
        runDate: "2026-08-04",
        sourceKeys: [],
      }).success,
    ).toBe(false);
  });

  it("parses explicit false query filters without truthiness coercion", () => {
    expect(
      candidateQuerySchema.parse({
        gatePassed: "false",
        doNotResurface: "true",
      }),
    ).toMatchObject({
      gatePassed: false,
      doNotResurface: true,
    });
  });

  it("validates scan history ranges and unique source keys", () => {
    expect(
      createScanSchema.safeParse({
        runDate: "2026-08-04",
        sourceKeys: ["github", "github"],
      }).success,
    ).toBe(false);
    expect(
      scanQuerySchema.safeParse({
        from: "2026-08-05",
        to: "2026-08-04",
      }).success,
    ).toBe(false);
  });
});
