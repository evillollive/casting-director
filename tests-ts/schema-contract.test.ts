import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    "prisma/migrations/20260804190000_tier_2_foundation/migration.sql",
  ),
  "utf8",
);

describe("database invariants", () => {
  it("models normalized tags and append-only authored notes", () => {
    expect(schema).toContain("model CandidateTag");
    expect(schema).toContain("model CandidateNote");
    expect(migration).toContain('"candidate_notes_append_only"');
  });

  it("enforces one active scan for each workspace", () => {
    expect(migration).toContain('"scans_one_active_per_workspace"');
    expect(migration).toContain("WHERE \"status\" IN ('PENDING', 'RUNNING')");
  });

  it("enforces shortlist gates independently of overall score", () => {
    expect(migration).toContain("scan_candidates_gate_matches_scores");
    expect(migration).toContain("scan_candidate_shortlist_requires_gate");
    expect(migration).toContain(
      `"gatePassed" = ("protagonistScore" >= 3 AND "visibleHookScore" >= 3)`,
    );
  });

  it("blocks completion with evaluator errors and freezes completed scans", () => {
    expect(migration).toContain("prevent_scan_completion_with_errors");
    expect(migration).toContain(
      "completed scans require a passing evaluator with no ERROR violations",
    );
    expect(migration).toContain('"completed_scans_immutable"');
    expect(migration).toContain('"completed_scan_candidates_immutable"');
    expect(migration).toContain('"completed_scan_violations_immutable"');
  });

  it("stores immutable tuning and taste-log revisions", () => {
    expect(schema).toContain("model TuningConfigRevision");
    expect(schema).toContain("finalizedAt");
    expect(schema).toContain("model TasteLogEntryRevision");
    expect(migration).toContain('"tuning_revisions_immutable"');
    expect(migration).toContain('"taste_log_revisions_immutable"');
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });

  it("scopes source fingerprints to each workspace", () => {
    expect(schema).toContain(
      "@@unique([workspaceId, sourceId, fingerprint])",
    );
    expect(schema).toContain(
      "@relation(fields: [candidateId, workspaceId], references: [id, workspaceId]",
    );
  });

  it("enforces workspace isolation on scoped relationships", () => {
    expect(migration).toContain('"candidate_tag_workspace"');
    expect(migration).toContain('"candidate_merge_workspace"');
    expect(migration).toContain('"scan_candidate_workspace"');
    expect(migration).toContain('"violation_candidate_workspace"');
    expect(migration).toContain('"scan_tuning_workspace"');
    expect(migration).toContain('"active_tuning_revision_ownership"');
  });
});
