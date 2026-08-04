import { describe, expect, it } from "vitest";
import {
  normalizeDnrIdentity,
  parseDoNotResurface,
  parseTasteLog,
} from "@/server/import/markdown-memory";

describe("markdown memory import", () => {
  it("normalizes identities exactly like the canonical Python evaluator", () => {
    expect(normalizeDnrIdentity(" https://github.com/@OctoCat/ ")).toBe(
      "octocat",
    );
    expect(normalizeDnrIdentity("  Ada   Lovelace ")).toBe("ada lovelace");
    expect(normalizeDnrIdentity("@ Ada")).toBe("ada");
    expect(normalizeDnrIdentity("@@Ada")).toBe("ada");
  });

  it("imports real DNR rows and skips headers and examples", () => {
    const markdown = `
| Name / handle | Project | Status | Date | Note |
|---|---|---|---|---|
| _example: octocat_ | _example_ | _passed_ | _2026-01-01_ | _skip_ |
| @Ada | Engine | contacted | 2026-07-21 | Great voice |
`;
    expect(parseDoNotResurface(markdown)).toEqual([
      {
        name: "@Ada",
        project: "Engine",
        status: "CONTACTED",
        date: "2026-07-21",
        note: "Great voice",
        normalizedIdentity: "ada",
      },
    ]);
  });

  it("imports dated taste lines and ignores the template", () => {
    const markdown = `
- _Week of ____:_
- _Week of 2026-07-21:_ More independent makers.
`;
    expect(parseTasteLog(markdown)).toEqual([
      { weekOf: "2026-07-21", note: "More independent makers." },
    ]);
  });
});
