-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('READY', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TYPE "WorkerProcessStatus" AS ENUM ('STARTING', 'READY', 'DRAINING');

-- AlterTable
ALTER TABLE "scans"
ADD COLUMN "promptSnapshot" JSONB DEFAULT '{"legacy":true}'::jsonb,
ADD COLUMN "configHash" TEXT DEFAULT 'legacy-unavailable',
ADD COLUMN "tuningHash" TEXT DEFAULT 'legacy-unavailable',
ADD COLUMN "tasteLogHash" TEXT DEFAULT 'legacy-unavailable',
ADD COLUMN "memoryHash" TEXT DEFAULT 'legacy-unavailable',
ADD COLUMN "memorySnapshot" JSONB DEFAULT '[]'::jsonb,
ADD COLUMN "doNotResurfaceHash" TEXT DEFAULT 'legacy-unavailable',
ADD COLUMN "doNotResurfaceSnapshot" JSONB DEFAULT '[]'::jsonb;

ALTER TABLE "scans"
ALTER COLUMN "promptSnapshot" DROP DEFAULT,
ALTER COLUMN "configHash" DROP DEFAULT,
ALTER COLUMN "tuningHash" DROP DEFAULT,
ALTER COLUMN "tasteLogHash" DROP DEFAULT,
ALTER COLUMN "memoryHash" DROP DEFAULT,
ALTER COLUMN "memorySnapshot" DROP DEFAULT,
ALTER COLUMN "doNotResurfaceHash" DROP DEFAULT,
ALTER COLUMN "doNotResurfaceSnapshot" DROP DEFAULT;

ALTER TABLE "sources"
ADD COLUMN "executable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'READY',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "worker_processes" (
    "id" TEXT NOT NULL,
    "status" "WorkerProcessStatus" NOT NULL DEFAULT 'STARTING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "worker_processes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scan_jobs_scanId_key" ON "scan_jobs"("scanId");
CREATE INDEX "scan_jobs_status_availableAt_leaseExpiresAt_idx"
ON "scan_jobs"("status", "availableAt", "leaseExpiresAt");
CREATE INDEX "worker_processes_status_lastHeartbeat_idx"
ON "worker_processes"("status", "lastHeartbeat");

ALTER TABLE "scan_jobs"
ADD CONSTRAINT "scan_jobs_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "scans"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_jobs"
ADD CONSTRAINT "scan_job_attempts_are_bounded"
CHECK ("attempt" >= 0 AND "maxAttempts" > 0 AND "attempt" <= "maxAttempts");

ALTER TABLE "scan_jobs"
ADD CONSTRAINT "scan_job_lease_matches_status"
CHECK (
    (
        "status" = 'RUNNING'
        AND "leaseOwner" IS NOT NULL
        AND "leaseToken" IS NOT NULL
        AND "leaseExpiresAt" IS NOT NULL
        AND "heartbeatAt" IS NOT NULL
    )
    OR (
        "status" <> 'RUNNING'
        AND "leaseOwner" IS NULL
        AND "leaseToken" IS NULL
        AND "leaseExpiresAt" IS NULL
    )
);

INSERT INTO "scan_jobs" (
    "id", "scanId", "status", "attempt", "maxAttempts", "availableAt",
    "updatedAt"
)
SELECT
    'legacy-job-' || "id", "id", 'READY', 0, 3, CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "scans"
WHERE "status" IN ('PENDING', 'RUNNING')
ON CONFLICT ("scanId") DO NOTHING;

ALTER TABLE "scans"
ADD CONSTRAINT "completed_scan_requires_execution_snapshots"
CHECK (
    "status" <> 'COMPLETED'
    OR (
        "promptSnapshot" IS NOT NULL
        AND "configHash" IS NOT NULL
        AND "tuningHash" IS NOT NULL
        AND "tasteLogHash" IS NOT NULL
        AND "memoryHash" IS NOT NULL
        AND "memorySnapshot" IS NOT NULL
        AND "doNotResurfaceHash" IS NOT NULL
        AND "doNotResurfaceSnapshot" IS NOT NULL
    )
);

CREATE FUNCTION prevent_terminal_scan_job_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."status" IN ('SUCCEEDED', 'FAILED') THEN
        RAISE EXCEPTION 'terminal scan jobs are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "terminal_scan_jobs_immutable"
BEFORE UPDATE OR DELETE ON "scan_jobs"
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_scan_job_mutation();

INSERT INTO "sources" (
    "id", "key", "displayName", "family", "executable", "updatedAt"
) VALUES
    ('source-hacker-news', 'hacker-news', 'Hacker News', 'NEWS', true, CURRENT_TIMESTAMP),
    ('source-github', 'github', 'GitHub', 'CODE_HOST', true, CURRENT_TIMESTAMP),
    ('source-reddit', 'reddit', 'Reddit', 'COMMUNITY', true, CURRENT_TIMESTAMP),
    ('source-hackaday', 'hackaday', 'Hackaday', 'MAKER', true, CURRENT_TIMESTAMP),
    ('source-itch', 'itch.io', 'itch.io', 'GAMES', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
    "executable" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
