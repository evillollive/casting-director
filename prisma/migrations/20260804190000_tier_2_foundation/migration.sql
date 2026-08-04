-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthIdentityKind" AS ENUM ('OIDC', 'EMAIL', 'DEVELOPMENT');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('new', 'contacted', 'passed', 'cast', 'maybe-later');

-- CreateEnum
CREATE TYPE "SourceFamily" AS ENUM ('NEWS', 'CODE_HOST', 'COMMUNITY', 'MAKER', 'GAMES', 'VIDEO', 'SOCIAL', 'SCIENCE', 'CIVIC', 'ACCESSIBILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanSourceStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanCandidatePlacement" AS ENUM ('SHORTLIST', 'PARKING_LOT', 'HARD_EXCLUDED');

-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('ERROR', 'WARNING');

-- CreateEnum
CREATE TYPE "TuningItemKind" AS ENUM ('HARD_NO', 'MORE_OF');

-- CreateEnum
CREATE TYPE "MarkdownDocumentKind" AS ENUM ('DO_NOT_RESURFACE', 'TASTE_LOG');

-- CreateEnum
CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED_DATABASE', 'RESOLVED_MARKDOWN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AuthIdentityKind" NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_memberships" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "family" "SourceFamily" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "project" TEXT,
    "projectUrl" TEXT,
    "fingerprint" TEXT NOT NULL,
    "region" TEXT,
    "hook" TEXT,
    "whyNow" TEXT,
    "voice" TEXT,
    "arc" TEXT,
    "reach" TEXT,
    "caveat" TEXT,
    "sensitivity" TEXT,
    "rationale" TEXT,
    "protagonistScore" INTEGER,
    "visibleHookScore" INTEGER,
    "whyNowScore" INTEGER,
    "voiceScore" INTEGER,
    "arcScore" INTEGER,
    "reachScore" INTEGER,
    "overallScore" INTEGER,
    "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
    "gatePassed" BOOLEAN,
    "notForSurfacing" BOOLEAN NOT NULL DEFAULT false,
    "parkedReason" TEXT,
    "doNotResurface" BOOLEAN NOT NULL DEFAULT false,
    "status" "CandidateStatus" NOT NULL DEFAULT 'new',
    "firstScanId" TEXT,
    "latestScanId" TEXT,
    "mergedIntoId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_merges" (
    "id" TEXT NOT NULL,
    "sourceCandidateId" TEXT NOT NULL,
    "targetCandidateId" TEXT NOT NULL,
    "mergedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_provenance" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rawMetadata" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "candidate_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_tags" (
    "candidateId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_tags_pkey" PRIMARY KEY ("candidateId","tagId")
);

-- CreateTable
CREATE TABLE "candidate_notes" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_status_changes" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "fromStatus" "CandidateStatus",
    "toStatus" "CandidateStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "triggeredById" TEXT NOT NULL,
    "tuningRevisionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "candidatesFetched" INTEGER NOT NULL DEFAULT 0,
    "candidatesDeduped" INTEGER NOT NULL DEFAULT 0,
    "candidatesScreened" INTEGER NOT NULL DEFAULT 0,
    "shortlistCount" INTEGER NOT NULL DEFAULT 0,
    "parkingCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "reportMarkdown" TEXT,
    "error" TEXT,
    "runDate" DATE NOT NULL,
    "evalPassed" BOOLEAN,
    "promptHash" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "tuningSnapshot" JSONB NOT NULL,
    "tasteLogSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_sources" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "ScanSourceStatus" NOT NULL DEFAULT 'PENDING',
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scan_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_candidates" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "placement" "ScanCandidatePlacement" NOT NULL,
    "rank" INTEGER,
    "hook" TEXT NOT NULL,
    "whyNow" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "arc" TEXT NOT NULL,
    "reach" TEXT NOT NULL,
    "caveat" TEXT,
    "sensitivity" TEXT,
    "rationale" TEXT NOT NULL,
    "protagonistScore" INTEGER NOT NULL,
    "visibleHookScore" INTEGER NOT NULL,
    "whyNowScore" INTEGER NOT NULL,
    "voiceScore" INTEGER NOT NULL,
    "arcScore" INTEGER NOT NULL,
    "reachScore" INTEGER NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
    "gatePassed" BOOLEAN NOT NULL,
    "notForSurfacing" BOOLEAN NOT NULL DEFAULT false,
    "parkedReason" TEXT,
    "modelMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluator_violations" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "candidateId" TEXT,
    "code" TEXT NOT NULL,
    "severity" "ViolationSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "candidateReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluator_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tuning_configs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "activeRevisionId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tuning_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tuning_config_revisions" (
    "id" TEXT NOT NULL,
    "tuningConfigId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "beat" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "tuning_config_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tuning_revision_items" (
    "id" TEXT NOT NULL,
    "tuningRevisionId" TEXT NOT NULL,
    "kind" "TuningItemKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "tuning_revision_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taste_log_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "taste_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taste_log_entry_revisions" (
    "id" TEXT NOT NULL,
    "tasteLogEntryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taste_log_entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markdown_sync_states" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "document" "MarkdownDocumentKind" NOT NULL,
    "lastImportedRepositoryRevision" TEXT,
    "lastExportedDatabaseRevision" INTEGER,
    "lastImportedAt" TIMESTAMP(3),
    "lastExportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "markdown_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markdown_sync_conflicts" (
    "id" TEXT NOT NULL,
    "syncStateId" TEXT NOT NULL,
    "normalizedIdentity" TEXT NOT NULL,
    "databaseSnapshot" JSONB NOT NULL,
    "markdownSnapshot" JSONB NOT NULL,
    "status" "SyncConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "markdown_sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "auth_identities_userId_idx" ON "auth_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_kind_issuer_subject_key" ON "auth_identities"("kind", "issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_expiresAt_idx" ON "auth_sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspace_memberships_userId_idx" ON "workspace_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_memberships_workspaceId_userId_key" ON "workspace_memberships"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_key_key" ON "sources"("key");

-- CreateIndex
CREATE INDEX "sources_family_active_idx" ON "sources"("family", "active");

-- CreateIndex
CREATE INDEX "candidates_workspaceId_status_updatedAt_idx" ON "candidates"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "candidates_workspaceId_doNotResurface_notForSurfacing_idx" ON "candidates"("workspaceId", "doNotResurface", "notForSurfacing");

-- CreateIndex
CREATE INDEX "candidates_workspaceId_gatePassed_overallScore_idx" ON "candidates"("workspaceId", "gatePassed", "overallScore");

-- CreateIndex
CREATE INDEX "candidates_mergedIntoId_idx" ON "candidates"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_workspaceId_fingerprint_key" ON "candidates"("workspaceId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_id_workspaceId_key" ON "candidates"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "candidate_merges_targetCandidateId_idx" ON "candidate_merges"("targetCandidateId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_merges_sourceCandidateId_key" ON "candidate_merges"("sourceCandidateId");

-- CreateIndex
CREATE INDEX "candidate_provenance_candidateId_lastSeenAt_idx" ON "candidate_provenance"("candidateId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_provenance_workspaceId_sourceId_fingerprint_key" ON "candidate_provenance"("workspaceId", "sourceId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspaceId_slug_key" ON "tags"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "candidate_tags_tagId_idx" ON "candidate_tags"("tagId");

-- CreateIndex
CREATE INDEX "candidate_notes_candidateId_createdAt_idx" ON "candidate_notes"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "candidate_status_changes_candidateId_createdAt_idx" ON "candidate_status_changes"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "scans_workspaceId_status_createdAt_idx" ON "scans"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "scans_workspaceId_runDate_idx" ON "scans"("workspaceId", "runDate");

-- CreateIndex
CREATE INDEX "scan_sources_scanId_status_idx" ON "scan_sources"("scanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scan_sources_scanId_sourceId_key" ON "scan_sources"("scanId", "sourceId");

-- CreateIndex
CREATE INDEX "scan_candidates_scanId_placement_rank_idx" ON "scan_candidates"("scanId", "placement", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "scan_candidates_scanId_candidateId_key" ON "scan_candidates"("scanId", "candidateId");

-- CreateIndex
CREATE INDEX "evaluator_violations_scanId_severity_idx" ON "evaluator_violations"("scanId", "severity");

-- CreateIndex
CREATE INDEX "evaluator_violations_candidateId_idx" ON "evaluator_violations"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "tuning_configs_workspaceId_key" ON "tuning_configs"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "tuning_configs_activeRevisionId_key" ON "tuning_configs"("activeRevisionId");

-- CreateIndex
CREATE INDEX "tuning_config_revisions_tuningConfigId_createdAt_idx" ON "tuning_config_revisions"("tuningConfigId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tuning_config_revisions_tuningConfigId_revision_key" ON "tuning_config_revisions"("tuningConfigId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "tuning_revision_items_tuningRevisionId_kind_position_key" ON "tuning_revision_items"("tuningRevisionId", "kind", "position");

-- CreateIndex
CREATE INDEX "taste_log_entries_workspaceId_weekOf_idx" ON "taste_log_entries"("workspaceId", "weekOf");

-- CreateIndex
CREATE INDEX "taste_log_entry_revisions_tasteLogEntryId_createdAt_idx" ON "taste_log_entry_revisions"("tasteLogEntryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "taste_log_entry_revisions_tasteLogEntryId_revision_key" ON "taste_log_entry_revisions"("tasteLogEntryId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "markdown_sync_states_workspaceId_document_key" ON "markdown_sync_states"("workspaceId", "document");

-- CreateIndex
CREATE INDEX "markdown_sync_conflicts_syncStateId_status_idx" ON "markdown_sync_conflicts"("syncStateId", "status");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_firstScanId_fkey" FOREIGN KEY ("firstScanId") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_latestScanId_fkey" FOREIGN KEY ("latestScanId") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_targetCandidateId_fkey" FOREIGN KEY ("targetCandidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_merges" ADD CONSTRAINT "candidate_merges_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_provenance" ADD CONSTRAINT "candidate_provenance_candidateId_workspaceId_fkey" FOREIGN KEY ("candidateId", "workspaceId") REFERENCES "candidates"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_provenance" ADD CONSTRAINT "candidate_provenance_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_status_changes" ADD CONSTRAINT "candidate_status_changes_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_status_changes" ADD CONSTRAINT "candidate_status_changes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_tuningRevisionId_fkey" FOREIGN KEY ("tuningRevisionId") REFERENCES "tuning_config_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_sources" ADD CONSTRAINT "scan_sources_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_sources" ADD CONSTRAINT "scan_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_candidates" ADD CONSTRAINT "scan_candidates_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_candidates" ADD CONSTRAINT "scan_candidates_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluator_violations" ADD CONSTRAINT "evaluator_violations_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluator_violations" ADD CONSTRAINT "evaluator_violations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_configs" ADD CONSTRAINT "tuning_configs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_configs" ADD CONSTRAINT "tuning_configs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_configs" ADD CONSTRAINT "tuning_configs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_configs" ADD CONSTRAINT "tuning_configs_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "tuning_config_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_config_revisions" ADD CONSTRAINT "tuning_config_revisions_tuningConfigId_fkey" FOREIGN KEY ("tuningConfigId") REFERENCES "tuning_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_config_revisions" ADD CONSTRAINT "tuning_config_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuning_revision_items" ADD CONSTRAINT "tuning_revision_items_tuningRevisionId_fkey" FOREIGN KEY ("tuningRevisionId") REFERENCES "tuning_config_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_log_entries" ADD CONSTRAINT "taste_log_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_log_entries" ADD CONSTRAINT "taste_log_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_log_entries" ADD CONSTRAINT "taste_log_entries_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_log_entry_revisions" ADD CONSTRAINT "taste_log_entry_revisions_tasteLogEntryId_fkey" FOREIGN KEY ("tasteLogEntryId") REFERENCES "taste_log_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_log_entry_revisions" ADD CONSTRAINT "taste_log_entry_revisions_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markdown_sync_states" ADD CONSTRAINT "markdown_sync_states_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markdown_sync_conflicts" ADD CONSTRAINT "markdown_sync_conflicts_syncStateId_fkey" FOREIGN KEY ("syncStateId") REFERENCES "markdown_sync_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markdown_sync_conflicts" ADD CONSTRAINT "markdown_sync_conflicts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One durable job may source or screen for a workspace at a time.
CREATE UNIQUE INDEX "scans_one_active_per_workspace"
ON "scans" ("workspaceId")
WHERE "status" IN ('PENDING', 'RUNNING');

-- The two shortlist dimensions are gates, never an average.
ALTER TABLE "candidates"
ADD CONSTRAINT "candidates_gate_matches_scores"
CHECK (
    "gatePassed" IS NULL
    OR (
        "protagonistScore" IS NOT NULL
        AND "visibleHookScore" IS NOT NULL
        AND "gatePassed" = ("protagonistScore" >= 3 AND "visibleHookScore" >= 3)
    )
);

ALTER TABLE "scan_candidates"
ADD CONSTRAINT "scan_candidates_gate_matches_scores"
CHECK ("gatePassed" = ("protagonistScore" >= 3 AND "visibleHookScore" >= 3));

ALTER TABLE "scan_candidates"
ADD CONSTRAINT "scan_candidate_shortlist_requires_gate"
CHECK ("placement" <> 'SHORTLIST' OR "gatePassed" = true);

ALTER TABLE "scan_candidates"
ADD CONSTRAINT "scan_candidate_scores_in_range"
CHECK (
    "protagonistScore" BETWEEN 0 AND 5
    AND "visibleHookScore" BETWEEN 0 AND 5
    AND "whyNowScore" BETWEEN 0 AND 5
    AND "voiceScore" BETWEEN 0 AND 5
    AND "arcScore" BETWEEN 0 AND 5
    AND "reachScore" BETWEEN 0 AND 5
    AND "overallScore" BETWEEN 0 AND 5
);

ALTER TABLE "scans"
ADD CONSTRAINT "scan_counts_are_nonnegative"
CHECK (
    "candidatesFetched" >= 0
    AND "candidatesDeduped" >= 0
    AND "candidatesScreened" >= 0
    AND "shortlistCount" >= 0
    AND "parkingCount" >= 0
);

CREATE FUNCTION prevent_scan_completion_with_errors()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."status" = 'COMPLETED' AND (
        NEW."evalPassed" IS DISTINCT FROM TRUE
        OR EXISTS (
            SELECT 1
            FROM "evaluator_violations"
            WHERE "scanId" = NEW."id" AND "severity" = 'ERROR'
        )
    ) THEN
        RAISE EXCEPTION 'completed scans require a passing evaluator with no ERROR violations';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "scans_require_clean_evaluation"
AFTER INSERT OR UPDATE OF "status", "evalPassed" ON "scans"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION prevent_scan_completion_with_errors();

CREATE FUNCTION enforce_candidate_workspace_links()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."mergedIntoId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "candidates"
        WHERE "id" = NEW."mergedIntoId"
        AND "workspaceId" = NEW."workspaceId"
    ) THEN
        RAISE EXCEPTION 'merged candidates must belong to the same workspace';
    END IF;
    IF NEW."firstScanId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "scans"
        WHERE "id" = NEW."firstScanId"
        AND "workspaceId" = NEW."workspaceId"
    ) THEN
        RAISE EXCEPTION 'candidate first scan must belong to the same workspace';
    END IF;
    IF NEW."latestScanId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "scans"
        WHERE "id" = NEW."latestScanId"
        AND "workspaceId" = NEW."workspaceId"
    ) THEN
        RAISE EXCEPTION 'candidate latest scan must belong to the same workspace';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "candidate_workspace_links"
BEFORE INSERT OR UPDATE OF "workspaceId", "mergedIntoId", "firstScanId", "latestScanId"
ON "candidates"
FOR EACH ROW EXECUTE FUNCTION enforce_candidate_workspace_links();

CREATE FUNCTION enforce_candidate_merge_workspace()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "candidates" source
        JOIN "candidates" target
          ON target."id" = NEW."targetCandidateId"
         AND target."workspaceId" = source."workspaceId"
        WHERE source."id" = NEW."sourceCandidateId"
    ) THEN
        RAISE EXCEPTION 'candidate merge records cannot cross workspaces';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "candidate_merge_workspace"
BEFORE INSERT OR UPDATE OF "sourceCandidateId", "targetCandidateId"
ON "candidate_merges"
FOR EACH ROW EXECUTE FUNCTION enforce_candidate_merge_workspace();

CREATE FUNCTION enforce_candidate_tag_workspace()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "candidates" candidate
        JOIN "tags" tag
          ON tag."id" = NEW."tagId"
         AND tag."workspaceId" = candidate."workspaceId"
        WHERE candidate."id" = NEW."candidateId"
    ) THEN
        RAISE EXCEPTION 'candidate tags cannot cross workspaces';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "candidate_tag_workspace"
BEFORE INSERT OR UPDATE OF "candidateId", "tagId"
ON "candidate_tags"
FOR EACH ROW EXECUTE FUNCTION enforce_candidate_tag_workspace();

CREATE FUNCTION enforce_scan_candidate_workspace()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "scans" scan
        JOIN "candidates" candidate
          ON candidate."id" = NEW."candidateId"
         AND candidate."workspaceId" = scan."workspaceId"
        WHERE scan."id" = NEW."scanId"
    ) THEN
        RAISE EXCEPTION 'scan candidates cannot cross workspaces';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "scan_candidate_workspace"
BEFORE INSERT OR UPDATE OF "scanId", "candidateId"
ON "scan_candidates"
FOR EACH ROW EXECUTE FUNCTION enforce_scan_candidate_workspace();

CREATE FUNCTION enforce_violation_candidate_workspace()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."candidateId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "scans" scan
        JOIN "candidates" candidate
          ON candidate."id" = NEW."candidateId"
         AND candidate."workspaceId" = scan."workspaceId"
        WHERE scan."id" = NEW."scanId"
    ) THEN
        RAISE EXCEPTION 'evaluator candidate references cannot cross workspaces';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "violation_candidate_workspace"
BEFORE INSERT OR UPDATE OF "scanId", "candidateId"
ON "evaluator_violations"
FOR EACH ROW EXECUTE FUNCTION enforce_violation_candidate_workspace();

CREATE FUNCTION enforce_tuning_workspace()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."tuningRevisionId" IS NOT NULL THEN
        PERFORM 1
        FROM "tuning_config_revisions" revision
        JOIN "tuning_configs" config
          ON config."id" = revision."tuningConfigId"
         AND config."workspaceId" = NEW."workspaceId"
        WHERE revision."id" = NEW."tuningRevisionId"
        AND revision."finalizedAt" IS NOT NULL
        FOR UPDATE OF revision;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'scan tuning revisions must be finalized in the same workspace';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "scan_tuning_workspace"
BEFORE INSERT OR UPDATE OF "workspaceId", "tuningRevisionId"
ON "scans"
FOR EACH ROW EXECUTE FUNCTION enforce_tuning_workspace();

CREATE FUNCTION enforce_active_tuning_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."activeRevisionId" IS NOT NULL THEN
        PERFORM 1 FROM "tuning_config_revisions"
        WHERE "id" = NEW."activeRevisionId"
        AND "tuningConfigId" = NEW."id"
        AND "finalizedAt" IS NOT NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'active tuning revision must be finalized for its configuration';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "active_tuning_revision_ownership"
BEFORE INSERT OR UPDATE OF "activeRevisionId"
ON "tuning_configs"
FOR EACH ROW EXECUTE FUNCTION enforce_active_tuning_revision();

CREATE FUNCTION prevent_workspace_reassignment()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId" THEN
        RAISE EXCEPTION '% cannot move between workspaces', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "candidate_workspace_immutable"
BEFORE UPDATE OF "workspaceId" ON "candidates"
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_reassignment();

CREATE TRIGGER "tag_workspace_immutable"
BEFORE UPDATE OF "workspaceId" ON "tags"
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_reassignment();

CREATE TRIGGER "scan_workspace_immutable"
BEFORE UPDATE OF "workspaceId" ON "scans"
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_reassignment();

CREATE TRIGGER "tuning_workspace_immutable"
BEFORE UPDATE OF "workspaceId" ON "tuning_configs"
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_reassignment();

CREATE TRIGGER "taste_log_workspace_immutable"
BEFORE UPDATE OF "workspaceId" ON "taste_log_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_reassignment();

CREATE TRIGGER "sync_state_workspace_immutable"
BEFORE UPDATE OF "workspaceId" ON "markdown_sync_states"
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_reassignment();

CREATE FUNCTION prevent_completed_scan_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."status" = 'COMPLETED' THEN
        RAISE EXCEPTION 'completed scan audit records are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "completed_scans_immutable"
BEFORE UPDATE OR DELETE ON "scans"
FOR EACH ROW EXECUTE FUNCTION prevent_completed_scan_mutation();

CREATE FUNCTION prevent_completed_scan_child_mutation()
RETURNS TRIGGER AS $$
DECLARE
    old_scan_id TEXT;
    new_scan_id TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_scan_id := OLD."scanId";
        PERFORM 1 FROM "scans"
        WHERE "id" = old_scan_id
        FOR UPDATE;
        IF EXISTS (
            SELECT 1 FROM "scans"
            WHERE "id" = old_scan_id AND "status" = 'COMPLETED'
        ) THEN
            RAISE EXCEPTION 'completed scan child records are immutable';
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        new_scan_id := NEW."scanId";
        IF old_scan_id IS DISTINCT FROM new_scan_id THEN
            PERFORM 1 FROM "scans"
            WHERE "id" = new_scan_id
            FOR UPDATE;
        END IF;
        IF EXISTS (
            SELECT 1 FROM "scans"
            WHERE "id" = new_scan_id AND "status" = 'COMPLETED'
        ) THEN
            RAISE EXCEPTION 'completed scan child records are immutable';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "completed_scan_sources_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "scan_sources"
FOR EACH ROW EXECUTE FUNCTION prevent_completed_scan_child_mutation();

CREATE TRIGGER "completed_scan_candidates_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "scan_candidates"
FOR EACH ROW EXECUTE FUNCTION prevent_completed_scan_child_mutation();

CREATE TRIGGER "completed_scan_violations_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "evaluator_violations"
FOR EACH ROW EXECUTE FUNCTION prevent_completed_scan_child_mutation();

CREATE FUNCTION prevent_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "candidate_notes_append_only"
BEFORE UPDATE OR DELETE ON "candidate_notes"
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

CREATE TRIGGER "candidate_status_changes_append_only"
BEFORE UPDATE OR DELETE ON "candidate_status_changes"
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

CREATE TRIGGER "candidate_merges_append_only"
BEFORE UPDATE OR DELETE ON "candidate_merges"
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

CREATE FUNCTION protect_tuning_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'tuning_config_revisions is append-only';
    END IF;
    IF OLD."finalizedAt" IS NULL
       AND NEW."finalizedAt" IS NOT NULL
       AND NEW."id" IS NOT DISTINCT FROM OLD."id"
       AND NEW."tuningConfigId" IS NOT DISTINCT FROM OLD."tuningConfigId"
       AND NEW."revision" IS NOT DISTINCT FROM OLD."revision"
       AND NEW."beat" IS NOT DISTINCT FROM OLD."beat"
       AND NEW."createdById" IS NOT DISTINCT FROM OLD."createdById"
       AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'tuning_config_revisions is immutable after creation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tuning_revisions_immutable"
BEFORE UPDATE OR DELETE ON "tuning_config_revisions"
FOR EACH ROW EXECUTE FUNCTION protect_tuning_revision();

CREATE TRIGGER "tuning_revision_items_immutable"
BEFORE UPDATE OR DELETE ON "tuning_revision_items"
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

CREATE FUNCTION prevent_locked_tuning_item_insert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM 1 FROM "tuning_config_revisions"
    WHERE "id" = NEW."tuningRevisionId"
    AND "finalizedAt" IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'finalized tuning revisions are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tuning_revision_items_lock_after_use"
BEFORE INSERT ON "tuning_revision_items"
FOR EACH ROW EXECUTE FUNCTION prevent_locked_tuning_item_insert();

CREATE TRIGGER "taste_log_revisions_immutable"
BEFORE UPDATE OR DELETE ON "taste_log_entry_revisions"
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
