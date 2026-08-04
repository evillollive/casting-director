import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  "prisma/migrations/20260804190000_tier_2_foundation/migration.sql",
);

let database: PGlite;

function scanInsert(id: string, status: "PENDING" | "RUNNING"): string {
  return `
    INSERT INTO "scans" (
      "id", "workspaceId", "status", "triggeredById", "runDate",
      "promptHash", "configSnapshot", "tuningSnapshot", "tasteLogSnapshot",
      "updatedAt"
    ) VALUES (
      '${id}', 'workspace-1', '${status}', 'user-1', DATE '2026-08-04',
      'prompt-hash', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, CURRENT_TIMESTAMP
    )
  `;
}

describe.sequential("PostgreSQL migration", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(await readFile(migrationPath, "utf8"));
    await database.exec(`
      INSERT INTO "users" (
        "id", "email", "displayName", "updatedAt"
      ) VALUES (
        'user-1', 'editor@example.com', 'Editor', CURRENT_TIMESTAMP
      );
      INSERT INTO "workspaces" (
        "id", "slug", "name", "updatedAt"
      ) VALUES (
        'workspace-1', 'casting', 'Casting', CURRENT_TIMESTAMP
      );
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  it("applies the migration and creates the complete relational model", async () => {
    const result = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(result.rows[0]?.count).toBeGreaterThanOrEqual(24);
  });

  it("enforces one active scan in a workspace", async () => {
    await database.exec(scanInsert("scan-active", "PENDING"));
    await expect(
      database.exec(scanInsert("scan-competing", "RUNNING")),
    ).rejects.toThrow();
    await database.exec(`
      UPDATE "scans"
      SET "status" = 'FAILED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'scan-active'
    `);
  });

  it("rejects completion when an ERROR violation exists", async () => {
    await database.exec(scanInsert("scan-error", "RUNNING"));
    await database.exec(`
      INSERT INTO "evaluator_violations" (
        "id", "scanId", "code", "severity", "message"
      ) VALUES (
        'violation-error', 'scan-error', 'gate', 'ERROR', 'Gate failed'
      )
    `);
    await expect(
      database.exec(`
        UPDATE "scans"
        SET "status" = 'COMPLETED', "evalPassed" = true,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'scan-error'
      `),
    ).rejects.toThrow("completed scans require a passing evaluator");
    await database.exec(`
      UPDATE "scans"
      SET "status" = 'FAILED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'scan-error'
    `);
  });

  it("freezes completed scan output and child records", async () => {
    await database.exec(scanInsert("scan-clean", "RUNNING"));
    await database.exec(`
      INSERT INTO "evaluator_violations" (
        "id", "scanId", "code", "severity", "message"
      ) VALUES (
        'scan-clean-warning', 'scan-clean', 'cluster', 'WARNING',
        'Source cluster'
      )
    `);
    await database.exec(`
      UPDATE "scans"
      SET "status" = 'COMPLETED', "evalPassed" = true,
          "reportMarkdown" = '# Report', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'scan-clean'
    `);
    await expect(
      database.exec(`
        UPDATE "scans"
        SET "reportMarkdown" = '# Rewritten'
        WHERE "id" = 'scan-clean'
      `),
    ).rejects.toThrow("completed scan audit records are immutable");
    await expect(
      database.exec(`
        INSERT INTO "evaluator_violations" (
          "id", "scanId", "code", "severity", "message"
        ) VALUES (
          'late-warning', 'scan-clean', 'late', 'WARNING', 'Late warning'
        )
      `),
    ).rejects.toThrow("completed scan child records are immutable");
    await database.exec(scanInsert("scan-reparent-target", "RUNNING"));
    await expect(
      database.exec(`
        UPDATE "evaluator_violations"
        SET "scanId" = 'scan-reparent-target', "message" = 'Rewritten'
        WHERE "id" = 'scan-clean-warning'
      `),
    ).rejects.toThrow("completed scan child records are immutable");
    await database.exec(`
      UPDATE "scans"
      SET "status" = 'FAILED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'scan-reparent-target'
    `);
  });

  it("rejects shortlist placement when either gate fails", async () => {
    await database.exec(scanInsert("scan-gates", "RUNNING"));
    await database.exec(`
      INSERT INTO "candidates" (
        "id", "workspaceId", "name", "fingerprint", "updatedAt"
      ) VALUES (
        'candidate-1', 'workspace-1', 'Candidate', 'test:candidate',
        CURRENT_TIMESTAMP
      )
    `);
    await expect(
      database.exec(`
        INSERT INTO "scan_candidates" (
          "id", "scanId", "candidateId", "placement", "hook", "whyNow",
          "voice", "arc", "reach", "rationale", "protagonistScore",
          "visibleHookScore", "whyNowScore", "voiceScore", "arcScore",
          "reachScore", "overallScore", "gatePassed"
        ) VALUES (
          'screening-1', 'scan-gates', 'candidate-1', 'SHORTLIST',
          'Hook', 'Now', 'Voice', 'Arc', 'Reach', 'Rationale',
          5, 2, 4, 4, 4, 4, 5, false
        )
      `),
    ).rejects.toThrow();
    await database.exec(`
      UPDATE "scans"
      SET "status" = 'FAILED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'scan-gates'
    `);
  });

  it("rejects relationships that cross workspace boundaries", async () => {
    await database.exec(`
      INSERT INTO "workspaces" (
        "id", "slug", "name", "updatedAt"
      ) VALUES (
        'workspace-2', 'documentary', 'Documentary', CURRENT_TIMESTAMP
      );
      INSERT INTO "tags" (
        "id", "workspaceId", "name", "slug", "updatedAt"
      ) VALUES (
        'tag-workspace-2', 'workspace-2', 'Hardware', 'hardware',
        CURRENT_TIMESTAMP
      );
    `);
    await expect(
      database.exec(`
        INSERT INTO "candidate_tags" (
          "candidateId", "tagId"
        ) VALUES (
          'candidate-1', 'tag-workspace-2'
        )
      `),
    ).rejects.toThrow("candidate tags cannot cross workspaces");
    await expect(
      database.exec(`
        UPDATE "candidates"
        SET "workspaceId" = 'workspace-2'
        WHERE "id" = 'candidate-1'
      `),
    ).rejects.toThrow("candidates cannot move between workspaces");
  });

  it("permanently seals tuning revisions before activation", async () => {
    await database.exec(`
      INSERT INTO "tuning_configs" (
        "id", "workspaceId", "createdById", "updatedById", "updatedAt"
      ) VALUES (
        'tuning-1', 'workspace-1', 'user-1', 'user-1', CURRENT_TIMESTAMP
      );
      INSERT INTO "tuning_config_revisions" (
        "id", "tuningConfigId", "revision", "beat", "createdById"
      ) VALUES (
        'tuning-revision-1', 'tuning-1', 1, 'Independent makers', 'user-1'
      );
      INSERT INTO "tuning_revision_items" (
        "id", "tuningRevisionId", "kind", "position", "value"
      ) VALUES (
        'tuning-item-1', 'tuning-revision-1', 'MORE_OF', 0, 'Visible craft'
      );
      UPDATE "tuning_config_revisions"
      SET "finalizedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'tuning-revision-1';
      UPDATE "tuning_configs"
      SET "activeRevisionId" = 'tuning-revision-1',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'tuning-1';
      UPDATE "tuning_configs"
      SET "activeRevisionId" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'tuning-1';
    `);
    await expect(
      database.exec(`
        INSERT INTO "tuning_revision_items" (
          "id", "tuningRevisionId", "kind", "position", "value"
        ) VALUES (
          'late-tuning-item', 'tuning-revision-1', 'HARD_NO', 0,
          'Late mutation'
        )
      `),
    ).rejects.toThrow("finalized tuning revisions are immutable");
  });

  it("serializes child writes by locking the parent scan", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain(
      'WHERE "id" = new_scan_id\n            FOR UPDATE',
    );
  });
});
