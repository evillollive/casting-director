#!/usr/bin/env node
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readWorkerConfig } from "@/server/config";
import { prisma } from "@/server/db";
import {
  claimNextScanJob,
  LeaseLostError,
  releaseScanJobLease,
  retryOrFailScanJob,
} from "@/server/jobs/repository";
import {
  executeScanJob,
  ScanExecutionError,
} from "@/worker/executor";
import {
  claimNextRepositorySyncJob,
  completeRepositorySyncJob,
  retryOrFailRepositorySyncJob,
} from "@/server/sync/jobs";
import {
  executeRepositorySyncJob,
  RepositorySyncExecutionError,
} from "@/server/sync/worker";
import { redactLogText } from "@/server/logging";

const once = process.argv.includes("--once");
const healthcheck = process.argv.includes("--healthcheck");
const config = readWorkerConfig();
const workerId =
  config.CASTING_WORKER_ID ?? `${hostname()}:${process.pid}:${randomUUID()}`;
let stopping = false;

function log(level: "info" | "error", message: string, details = {}) {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    workerId,
    message: redactLogText(message),
    ...details,
  });
  (level === "error" ? console.error : console.log)(output);
}

function requestShutdown(signal: string) {
  stopping = true;
  log("info", "Graceful shutdown requested.", { signal });
}

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));

async function recordStatus(status: "STARTING" | "READY" | "DRAINING") {
  await prisma.workerProcess.upsert({
    where: { id: workerId },
    create: {
      id: workerId,
      status,
      metadata: {
        hostname: hostname(),
        pid: process.pid,
        protocolVersion: 1,
      },
    },
    update: {
      status,
      lastHeartbeat: new Date(),
      metadata: {
        hostname: hostname(),
        pid: process.pid,
        protocolVersion: 1,
      },
    },
  });
}

function sleep(milliseconds: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function checkReadiness() {
  await prisma.$queryRaw`SELECT 1`;
  const missing = [
    ["CASTING_LLM_API_KEY", config.CASTING_LLM_API_KEY],
    ["CASTING_LLM_API_URL", config.CASTING_LLM_API_URL],
    ["CASTING_LLM_MODEL", config.CASTING_LLM_MODEL],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Worker model configuration is incomplete: ${missing.join(", ")}.`,
    );
  }
  const probe = spawnSync(
    config.CASTING_PYTHON_BIN,
    [
      "-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(resolve(process.cwd(), "tools"))}); import tier2_scan_worker`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 },
  );
  if (probe.status !== 0) {
    throw new Error(
      `Python worker boundary is not ready: ${probe.stderr || probe.error?.message || "unknown error"}`,
    );
  }
}

async function run() {
  await checkReadiness();
  if (healthcheck) {
    console.log(JSON.stringify({ ready: true, worker: "tier-2-scan" }));
    return;
  }

  await recordStatus("STARTING");
  await recordStatus("READY");
  log("info", "Worker is ready.");
  while (!stopping) {
    await recordStatus("READY");
    const job = await claimNextScanJob(prisma, {
      workerId,
      leaseMs: config.CASTING_WORKER_LEASE_SECONDS * 1_000,
    });
    if (!job) {
      const repositoryJob = await claimNextRepositorySyncJob(prisma, {
        workerId,
        leaseMs: config.CASTING_WORKER_LEASE_SECONDS * 1_000,
      });
      if (repositoryJob) {
        log("info", "Claimed repository sync job.", {
          repositorySyncJobId: repositoryJob.id,
          document: repositoryJob.document,
          direction: repositoryJob.direction,
          attempt: repositoryJob.attempt,
        });
        try {
          const revision = await executeRepositorySyncJob(
            prisma,
            config,
            repositoryJob,
          );
          await completeRepositorySyncJob(prisma, repositoryJob, revision);
          log("info", "Finished repository sync job.", {
            repositorySyncJobId: repositoryJob.id,
            document: repositoryJob.document,
          });
        } catch (error) {
          const failure =
            error instanceof RepositorySyncExecutionError
              ? error
              : new RepositorySyncExecutionError(
                  "REPOSITORY_SYNC_ERROR",
                  error instanceof Error ? error.message : String(error),
                  true,
                );
          try {
            const outcome = await retryOrFailRepositorySyncJob(
              prisma,
              repositoryJob,
              failure,
            );
            log("error", failure.message, {
              repositorySyncJobId: repositoryJob.id,
              document: repositoryJob.document,
              code: failure.code,
              outcome,
            });
          } catch (persistenceError) {
            log(
              "error",
              persistenceError instanceof Error
                ? persistenceError.message
                : String(persistenceError),
              {
                repositorySyncJobId: repositoryJob.id,
                document: repositoryJob.document,
                code: "SYNC_FAILURE_PERSISTENCE_ERROR",
              },
            );
          }
        }
        if (once) break;
        continue;
      }
      if (once) break;
      await sleep(config.CASTING_WORKER_POLL_MS);
      continue;
    }
    if (stopping) {
      await releaseScanJobLease(prisma, job);
      log("info", "Released scan job during graceful shutdown.", {
        scanId: job.scanId,
      });
      break;
    }
    log("info", "Claimed scan job.", {
      scanId: job.scanId,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
    });
    try {
      await executeScanJob(prisma, config, job);
      log("info", "Finished scan job.", { scanId: job.scanId });
    } catch (error) {
      if (error instanceof LeaseLostError) {
        log("error", error.message, { scanId: job.scanId });
      } else {
        const failure =
          error instanceof ScanExecutionError
            ? error
            : new ScanExecutionError(
                "DATABASE_OR_WORKER_ERROR",
                error instanceof Error ? error.message : String(error),
                true,
              );
        try {
          const outcome = await retryOrFailScanJob(prisma, job, failure);
          log("error", failure.message, {
            scanId: job.scanId,
            code: failure.code,
            retryable: failure.retryable,
            outcome,
          });
        } catch (persistenceError) {
          log(
            "error",
            persistenceError instanceof Error
              ? persistenceError.message
              : String(persistenceError),
            { scanId: job.scanId, code: "FAILURE_PERSISTENCE_ERROR" },
          );
        }
      }
    }
    if (once) break;
  }
  await recordStatus("DRAINING");
  log("info", "Worker stopped accepting jobs.");
}

run()
  .catch((error) => {
    log("error", error instanceof Error ? error.message : String(error), {
      code: "WORKER_STARTUP_ERROR",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
