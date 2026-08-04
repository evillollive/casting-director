import type { PrismaClient } from "@prisma/client";
import type { WorkerConfig } from "@/server/config";
import { repositoryProvider } from "@/server/repository";
import type { ClaimedRepositorySyncJob } from "@/server/sync/jobs";
import {
  exportRepositoryDocument,
  reconcileRepository,
  RepositoryChangedError,
  SyncConflictsPendingError,
} from "@/server/sync/service";

export class RepositorySyncExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RepositorySyncExecutionError";
  }
}

export async function executeRepositorySyncJob(
  database: PrismaClient,
  config: WorkerConfig,
  job: ClaimedRepositorySyncJob,
): Promise<string | null> {
  if (!config.CASTING_SYNC_ACTOR_EMAIL) {
    throw new RepositorySyncExecutionError(
      "SYNC_ACTOR_MISSING",
      "CASTING_SYNC_ACTOR_EMAIL is required to process repository sync jobs.",
      false,
    );
  }
  const actor = await database.user.findFirst({
    where: {
      email: config.CASTING_SYNC_ACTOR_EMAIL,
      active: true,
      memberships: { some: { workspaceId: job.workspaceId } },
    },
    select: { id: true },
  });
  if (!actor) {
    throw new RepositorySyncExecutionError(
      "SYNC_ACTOR_UNAVAILABLE",
      "The configured repository sync actor is not an active workspace member.",
      false,
    );
  }

  try {
    const provider = repositoryProvider(config);
    if (job.direction === "EXPORT") {
      try {
        const exported = await exportRepositoryDocument(
          database,
          provider,
          job.workspaceId,
          job.document,
        );
        return exported.repositoryRevision;
      } catch (error) {
        if (!(error instanceof RepositoryChangedError)) throw error;
      }
    }
    const results = await reconcileRepository(database, provider, {
      workspaceId: job.workspaceId,
      userId: actor.id,
    }, [job.document]);
    const result = results[0];
    if (!result || result.conflictCount > 0) {
      throw new RepositorySyncExecutionError(
        "SYNC_CONFLICT",
        "Repository sync stopped with conflicts requiring human resolution.",
        false,
      );
    }
    return result.repositoryRevision;
  } catch (error) {
    if (error instanceof RepositorySyncExecutionError) throw error;
    if (error instanceof SyncConflictsPendingError) {
      throw new RepositorySyncExecutionError(
        "SYNC_CONFLICT",
        error.message,
        false,
      );
    }
    throw new RepositorySyncExecutionError(
      "REPOSITORY_SYNC_ERROR",
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}
