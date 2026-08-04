import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export type ClaimedScanJob = {
  id: string;
  scanId: string;
  attempt: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

type ClaimedRow = Omit<ClaimedScanJob, "leaseToken"> & {
  leaseToken: string | null;
};

export class LeaseLostError extends Error {
  constructor() {
    super("The scan job lease is no longer owned by this worker.");
    this.name = "LeaseLostError";
  }
}

export function calculateBackoffMs(
  attempt: number,
  baseMs = 5_000,
  maximumMs = 300_000,
): number {
  return Math.min(maximumMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

async function expireExhaustedJobs(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  const expired = await tx.$queryRaw<Array<{ scanId: string }>>`
    UPDATE "scan_jobs"
    SET
      "status" = 'FAILED',
      "leaseOwner" = NULL,
      "leaseToken" = NULL,
      "leaseExpiresAt" = NULL,
      "failureCode" = 'LEASE_EXHAUSTED',
      "lastError" = 'The worker lease expired after the final allowed attempt.',
      "updatedAt" = ${now},
      "version" = "version" + 1
    WHERE "status" = 'RUNNING'
      AND "leaseExpiresAt" <= ${now}
      AND "attempt" >= "maxAttempts"
    RETURNING "scanId"
  `;
  if (expired.length === 0) return;

  await tx.scan.updateMany({
    where: {
      id: { in: expired.map((job) => job.scanId) },
      status: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      completedAt: now,
      error: "The worker lease expired after the final allowed attempt.",
      version: { increment: 1 },
    },
  });
}

export async function claimNextScanJob(
  database: PrismaClient,
  input: {
    workerId: string;
    leaseMs: number;
    now?: Date;
  },
): Promise<ClaimedScanJob | null> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const leaseToken = randomUUID();

  return database.$transaction(async (tx) => {
    await expireExhaustedJobs(tx, now);
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      WITH candidate AS (
        SELECT job."id"
        FROM "scan_jobs" job
        JOIN "scans" scan ON scan."id" = job."scanId"
        WHERE scan."status" IN ('PENDING', 'RUNNING')
          AND job."attempt" < job."maxAttempts"
          AND (
            (job."status" = 'READY' AND job."availableAt" <= ${now})
            OR (
              job."status" = 'RUNNING'
              AND job."leaseExpiresAt" <= ${now}
            )
          )
        ORDER BY job."availableAt" ASC, job."createdAt" ASC
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1
      )
      UPDATE "scan_jobs" job
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
      RETURNING
        job."id",
        job."scanId",
        job."attempt",
        job."maxAttempts",
        job."leaseToken",
        job."leaseExpiresAt"
    `;
    const claimed = rows[0];
    if (!claimed?.leaseToken) return null;

    await tx.scan.updateMany({
      where: { id: claimed.scanId, status: "PENDING" },
      data: {
        status: "RUNNING",
        startedAt: now,
        error: null,
        version: { increment: 1 },
      },
    });
    return { ...claimed, leaseToken: claimed.leaseToken };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function heartbeatScanJob(
  database: PrismaClient,
  job: ClaimedScanJob,
  leaseMs: number,
  now = new Date(),
): Promise<void> {
  const result = await database.scanJob.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      leaseToken: job.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new LeaseLostError();
}

export async function releaseScanJobLease(
  database: PrismaClient,
  job: ClaimedScanJob,
  now = new Date(),
): Promise<void> {
  const result = await database.scanJob.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      leaseToken: job.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: "READY",
      attempt: { decrement: 1 },
      availableAt: now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new LeaseLostError();
}

export async function retryOrFailScanJob(
  database: PrismaClient,
  job: ClaimedScanJob,
  failure: { code: string; message: string; retryable: boolean },
  now = new Date(),
): Promise<"RETRY" | "FAILED"> {
  return database.$transaction(async (tx) => {
    const retry = failure.retryable && job.attempt < job.maxAttempts;
    const result = await tx.scanJob.updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        leaseToken: job.leaseToken,
        leaseExpiresAt: { gt: now },
      },
      data: retry
        ? {
            status: "READY",
            availableAt: new Date(
              now.getTime() + calculateBackoffMs(job.attempt),
            ),
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: now,
            failureCode: failure.code,
            lastError: failure.message,
            version: { increment: 1 },
          }
        : {
            status: "FAILED",
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

    await tx.scan.update({
      where: { id: job.scanId },
      data: retry
        ? {
            error: `Attempt ${job.attempt}/${job.maxAttempts} failed and will retry: ${failure.message}`,
            version: { increment: 1 },
          }
        : {
            status: "FAILED",
            completedAt: now,
            error: failure.message,
            version: { increment: 1 },
          },
    });
    return retry ? "RETRY" : "FAILED";
  });
}
