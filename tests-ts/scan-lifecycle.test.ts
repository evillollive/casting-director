import { describe, expect, it } from "vitest";
import {
  assertScanCanComplete,
  assertScanTransition,
  deriveGatePassed,
} from "@/domain/scan-lifecycle";

describe("scan lifecycle", () => {
  it("uses both explicit shortlist gates rather than an average", () => {
    expect(
      deriveGatePassed({ protagonistScore: 5, visibleHookScore: 2 }),
    ).toBe(false);
    expect(
      deriveGatePassed({ protagonistScore: 3, visibleHookScore: 3 }),
    ).toBe(true);
  });

  it("allows only forward terminal transitions", () => {
    expect(() => assertScanTransition("PENDING", "RUNNING")).not.toThrow();
    expect(() => assertScanTransition("FAILED", "RUNNING")).toThrow(
      "Scan cannot transition",
    );
  });

  it("refuses completion with an ERROR evaluator violation", () => {
    expect(() =>
      assertScanCanComplete({
        evalPassed: true,
        violations: [
          { code: "gate", severity: "ERROR", message: "Gate failed." },
        ],
      }),
    ).toThrow("Scan cannot transition");
  });

  it("permits warnings after a passing evaluator", () => {
    expect(() =>
      assertScanCanComplete({
        evalPassed: true,
        violations: [
          { code: "cluster", severity: "WARNING", message: "Source cluster." },
        ],
      }),
    ).not.toThrow();
  });
});
