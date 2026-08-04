import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  "prisma/migrations/20260804190000_tier_2_foundation/migration.sql",
);
const scanJobsMigrationPath = resolve(
  "prisma/migrations/20260804203000_tier_2_scan_jobs/migration.sql",
);
const repositoryOperationsMigrationPath = resolve(
  "prisma/migrations/20260804224500_tier_2_repository_operations/migration.sql",
);

let database: PGlite;

function scanInsert(id: string, status: "PENDING" | "RUNNING"): string {
  return `
    INSERT INTO "scans" (
      "id", "workspaceId", "status", "triggeredById", "runDate",
      "promptHash", "configSnapshot", "tuningSnapshot", "tasteLogSnapshot",
      "promptSnapshot", "configHash", "tuningHash", "tasteLogHash",
      "memoryHash", "memorySnapshot", "doNotResurfaceHash",
      "doNotResurfaceSnapshot", "updatedAt"
    ) VALUES (
      '${id}', 'workspace-1', '${status}', 'user-1', DATE '2026-08-04',
      'prompt-hash', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
      '{"canonicalPrompt":"prompt"}'::jsonb, 'config-hash', 'tuning-hash',
      'taste-hash', 'memory-hash', '[]'::jsonb, 'dnr-hash', '[]'::jsonb,
      CURRENT_TIMESTAMP
    )
  `;
}

describe.sequential("PostgreSQL migration", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(await readFile(migrationPath, "utf8"));
    await database.exec(await readFile(scanJobsMigrationPath, "utf8"));
    await database.exec(await readFile(repositoryOperationsMigrationPath, "utf8"));
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
    expect(result.rows[0]?.count).toBeGreaterThanOrEqual(27);
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

  it("serializes repository jobs for the same workspace document", async () => {
    await database.exec(`
      INSERT INTO "repository_sync_jobs" (
        "id", "workspaceId", "document", "direction", "status",
        "idempotencyKey", "updatedAt"
      ) VALUES
        ('repo-job-1', 'workspace-1', 'DO_NOT_RESURFACE', 'EXPORT', 'RUNNING',
         'repo-job-1', CURRENT_TIMESTAMP),
        ('repo-job-2', 'workspace-1', 'DO_NOT_RESURFACE', 'IMPORT', 'READY',
         'repo-job-2', CURRENT_TIMESTAMP)
    `);
    await expect(
      database.exec(`
        UPDATE "repository_sync_jobs"
        SET "status" = 'RUNNING', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'repo-job-2'
      `),
    ).rejects.toThrow();
    await database.exec(`
      UPDATE "repository_sync_jobs"
      SET "status" = 'SUCCEEDED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'repo-job-1'
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

  it("seeds the canonical provider-neutral source catalog", async () => {
    const result = await database.query<{ key: string }>(
      `SELECT "key" FROM "sources" ORDER BY "key"`,
    );
    expect(result.rows.map((row) => row.key)).toEqual([
      "github",
      "hackaday",
      "hacker-news",
      "itch.io",
      "reddit",
    ]);
  });

  it("enforces consistent leases and immutable terminal jobs", async () => {
    await database.exec(scanInsert("scan-job", "PENDING"));
    await database.exec(`
      INSERT INTO "scan_jobs" (
        "id", "scanId", "updatedAt"
      ) VALUES (
        'job-1', 'scan-job', CURRENT_TIMESTAMP
      )
    `);
    await expect(
      database.exec(`
        UPDATE "scan_jobs"
        SET "status" = 'RUNNING',
            "leaseOwner" = 'worker-1',
            "leaseToken" = NULL,
            "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '1 minute',
            "heartbeatAt" = CURRENT_TIMESTAMP,
            "attempt" = 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'job-1'
      `),
    ).rejects.toThrow();
    await database.exec(`
      UPDATE "scan_jobs"
      SET "status" = 'RUNNING',
          "leaseOwner" = 'worker-1',
          "leaseToken" = 'lease-1',
          "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '1 minute',
          "heartbeatAt" = CURRENT_TIMESTAMP,
          "attempt" = 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'job-1';
      UPDATE "scan_jobs"
      SET "status" = 'FAILED',
          "leaseOwner" = NULL,
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'job-1';
    `);
    await expect(
      database.exec(`
        UPDATE "scan_jobs"
        SET "lastError" = 'rewritten'
        WHERE "id" = 'job-1'
      `),
    ).rejects.toThrow("terminal scan jobs are immutable");
    await database.exec(`
      UPDATE "scans"
      SET "status" = 'FAILED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'scan-job'
    `);
  });

  it("reclaims expired leases without accepting a stale lease token", async () => {
    await database.exec(scanInsert("scan-recovery", "PENDING"));
    await database.exec(`
      INSERT INTO "scan_jobs" (
        "id", "scanId", "updatedAt"
      ) VALUES (
        'job-recovery', 'scan-recovery', CURRENT_TIMESTAMP
      );
      UPDATE "scan_jobs"
      SET "status" = 'RUNNING',
          "attempt" = 1,
          "leaseOwner" = 'worker-old',
          "leaseToken" = 'lease-old',
          "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute',
          "heartbeatAt" = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'job-recovery';
    `);
    const reclaimed = await database.query<{
      attempt: number;
      leaseToken: string;
    }>(`
      WITH candidate AS (
        SELECT "id"
        FROM "scan_jobs"
        WHERE "status" = 'RUNNING'
          AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
          AND "attempt" < "maxAttempts"
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "scan_jobs" job
      SET "attempt" = job."attempt" + 1,
          "leaseOwner" = 'worker-new',
          "leaseToken" = 'lease-new',
          "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '1 minute',
          "heartbeatAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."attempt", job."leaseToken"
    `);
    expect(reclaimed.rows).toEqual([
      { attempt: 2, leaseToken: "lease-new" },
    ]);

    const staleWrite = await database.query(`
      UPDATE "scan_jobs"
      SET "heartbeatAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'job-recovery'
        AND "leaseToken" = 'lease-old'
      RETURNING "id"
    `);
    expect(staleWrite.rows).toHaveLength(0);
  });

  it("upgrades legacy completed scans and enqueues legacy active scans", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(await readFile(migrationPath, "utf8"));
      await legacy.exec(`
        INSERT INTO "users" (
          "id", "email", "displayName", "updatedAt"
        ) VALUES (
          'legacy-user', 'legacy@example.com', 'Legacy', CURRENT_TIMESTAMP
        );
        INSERT INTO "workspaces" (
          "id", "slug", "name", "updatedAt"
        ) VALUES (
          'legacy-workspace', 'legacy', 'Legacy', CURRENT_TIMESTAMP
        );
        INSERT INTO "scans" (
          "id", "workspaceId", "status", "triggeredById", "runDate",
          "evalPassed", "promptHash", "configSnapshot", "tuningSnapshot",
          "tasteLogSnapshot", "updatedAt"
        ) VALUES (
          'legacy-completed', 'legacy-workspace', 'COMPLETED', 'legacy-user',
          DATE '2026-08-01', true, 'legacy-prompt', '{}'::jsonb,
          '{}'::jsonb, '[]'::jsonb, CURRENT_TIMESTAMP
        ), (
          'legacy-active', 'legacy-workspace', 'RUNNING', 'legacy-user',
          DATE '2026-08-04', NULL, 'legacy-prompt', '{}'::jsonb,
          '{}'::jsonb, '[]'::jsonb, CURRENT_TIMESTAMP
        );
      `);

      await legacy.exec(await readFile(scanJobsMigrationPath, "utf8"));
      const completed = await legacy.query<{
        promptSnapshot: { legacy: boolean };
      }>(`
        SELECT "promptSnapshot"
        FROM "scans"
        WHERE "id" = 'legacy-completed'
      `);
      const jobs = await legacy.query<{ scanId: string; status: string }>(`
        SELECT "scanId", "status"
        FROM "scan_jobs"
        WHERE "scanId" = 'legacy-active'
      `);

      expect(completed.rows[0]?.promptSnapshot).toEqual({ legacy: true });
      expect(jobs.rows).toEqual([
        { scanId: "legacy-active", status: "READY" },
      ]);
    } finally {
      await legacy.close();
    }
  });
});
