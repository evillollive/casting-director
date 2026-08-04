-- CreateEnum
CREATE TYPE "RepositorySyncDirection" AS ENUM ('IMPORT', 'EXPORT');

-- AlterTable
ALTER TABLE "markdown_sync_states"
ADD COLUMN "baseSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "lastDatabaseHash" TEXT,
ADD COLUMN "lastRepositoryHash" TEXT;

-- AlterTable
ALTER TABLE "candidates"
ADD COLUMN "doNotResurfaceDate" DATE,
ADD COLUMN "publicSyncNote" TEXT;

-- CreateTable
CREATE TABLE "repository_sync_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "document" "MarkdownDocumentKind" NOT NULL,
    "direction" "RepositorySyncDirection" NOT NULL,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'READY',
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "lastError" TEXT,
    "repositoryRevision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "repository_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_sync_jobs_workspaceId_idempotencyKey_key" ON "repository_sync_jobs"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "repository_sync_jobs_leaseToken_key" ON "repository_sync_jobs"("leaseToken");

-- CreateIndex
CREATE INDEX "repository_sync_jobs_status_availableAt_idx" ON "repository_sync_jobs"("status", "availableAt");

-- CreateIndex
CREATE INDEX "repository_sync_jobs_workspaceId_document_direction_createdAt_idx" ON "repository_sync_jobs"("workspaceId", "document", "direction", "createdAt");

-- Enforce one active repository operation per workspace document.
CREATE UNIQUE INDEX "repository_sync_jobs_one_running_per_document"
ON "repository_sync_jobs"("workspaceId", "document")
WHERE "status" = 'RUNNING';

-- A document identity can have only one unresolved decision.
CREATE UNIQUE INDEX "markdown_sync_conflicts_one_open_identity"
ON "markdown_sync_conflicts"("syncStateId", "normalizedIdentity")
WHERE "status" = 'OPEN';

-- AddForeignKey
ALTER TABLE "repository_sync_jobs" ADD CONSTRAINT "repository_sync_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
