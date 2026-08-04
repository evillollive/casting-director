import { describe, expect, it } from "vitest";
import { calculateBackoffMs } from "@/server/jobs/repository";
import { hashSnapshot, hashText } from "@/server/scan/snapshots";
import { workerEventSchema } from "@/worker/protocol";

describe("durable scan jobs", () => {
  it("uses bounded exponential retry delays", () => {
    expect(calculateBackoffMs(1)).toBe(5_000);
    expect(calculateBackoffMs(2)).toBe(10_000);
    expect(calculateBackoffMs(20)).toBe(300_000);
  });

  it("hashes equivalent structured snapshots deterministically", () => {
    expect(hashSnapshot({ b: 2, a: [1, 3] })).toBe(
      hashSnapshot({ a: [1, 3], b: 2 }),
    );
    expect(hashText("prompt")).toHaveLength(64);
  });

  it("rejects malformed Python worker events", () => {
    expect(
      workerEventSchema.safeParse({
        type: "source",
        source_key: "github",
        status: "completed",
        fetched_count: -1,
        error_code: null,
        error_message: null,
      }).success,
    ).toBe(false);
  });
});
