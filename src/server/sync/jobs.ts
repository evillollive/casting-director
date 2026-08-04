import { randomUUID } from "node:crypto";
import { Prisma, type MarkdownDocumentKind, type PrismaClient, type RepositorySyncDirection } from "@prisma/client";
import { calculateBackoffMs, LeaseLostError } from "@/server/jobs/repository";

export type ClaimedRepositorySyncJob = {
  id: string;
  workspaceId: string;
  document: MarkdownDocumentKind;
  direction: RepositorySyncDirection;
  attempt: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

type ClaimedRow = Omit<ClaimedRepositorySyncJob, "leaseToken"> & {
  leaseToken: string | null;
};

export async function claimNextRepositorySyncJob(
  database: PrismaClient,
  input: { workerId: string; leaseMs: number; now?: Date },
): Promise<ClaimedRepositorySyncJob | null> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const leaseToken = randomUUID();
  try {
    return await database.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "repository_sync_jobs"
      SET
        "status" = 'FAILED',
        "leaseOwner" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "failureCode" = 'LEASE_EXHAUSTED',
        "lastError" = 'The repository sync lease expired after its final attempt.',
        "updatedAt" = ${now},
        "version" = "version" + 1
      WHERE "status" = 'RUNNING'
        AND "leaseExpiresAt" <= ${now}
        AND "attempt" >= "maxAttempts"
    `;
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      WITH candidate AS (
        SELECT candidate_job."id"
        FROM "repository_sync_jobs" candidate_job
        WHERE candidate_job."attempt" < candidate_job."maxAttempts"
          AND (
            (candidate_job."status" = 'READY' AND candidate_job."availableAt" <= ${now})
            OR (
              candidate_job."status" = 'RUNNING'
              AND candidate_job."leaseExpiresAt" <= ${now}
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "repository_sync_jobs" active
            WHERE active."workspaceId" = candidate_job."workspaceId"
              AND active."document" = candidate_job."document"
              AND active."status" = 'RUNNING'
              AND active."leaseExpiresAt" > ${now}
          )
        ORDER BY candidate_job."availableAt" ASC, candidate_job."createdAt" ASC
        FOR UPDATE OF candidate_job SKIP LOCKED
        LIMIT 1
      )
      UPDATE "repository_sync_jobs" job
      SET
        "status" = 'RUNNING',
        "attempt" = job."attempt" + 1,
        "leaseOwner" = ${input.workerId},
        "leaseToken" = ${leaseToken},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "heartbeatAt" = ${now},
        "updatedAt" = ${now},
        "version" = job."version" + 1
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id", job."workspaceId", job."document", job."direction",
        job."attempt", job."maxAttempts", job."leaseToken", job."leaseExpiresAt"
    `;
    const claimed = rows[0];
    return claimed?.leaseToken
      ? { ...claimed, leaseToken: claimed.leaseToken }
      : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" ||
        (error.code === "P2010" && String(error.meta?.code) === "23505"))
    ) {
      return null;
    }
    throw error;
  }
}

export async function completeRepositorySyncJob(
  database: PrismaClient,
  job: ClaimedRepositorySyncJob,
  repositoryRevision: string | null,
  now = new Date(),
): Promise<void> {
  const result = await database.repositorySyncJob.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      leaseToken: job.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: "SUCCEEDED",
      repositoryRevision,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      failureCode: null,
      lastError: null,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new LeaseLostError();
}

export async function retryOrFailRepositorySyncJob(
  database: PrismaClient,
  job: ClaimedRepositorySyncJob,
  failure: { code: string; message: string; retryable: boolean },
  now = new Date(),
): Promise<"RETRY" | "FAILED"> {
  const retry = failure.retryable && job.attempt < job.maxAttempts;
  const result = await database.repositorySyncJob.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      leaseToken: job.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: retry ? "READY" : "FAILED",
      availableAt: retry
        ? new Date(now.getTime() + calculateBackoffMs(job.attempt))
        : undefined,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      failureCode: failure.code,
      lastError: failure.message,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new LeaseLostError();
  return retry ? "RETRY" : "FAILED";
}
