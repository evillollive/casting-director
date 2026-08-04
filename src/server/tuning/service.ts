import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { tuningUpdateSchema } from "@/domain/api-contract";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";

type TuningUpdate = z.infer<typeof tuningUpdateSchema>;

export class TuningVersionConflictError extends Error {
  constructor() {
    super("The tuning configuration changed after it was loaded.");
    this.name = "TuningVersionConflictError";
  }
}

const revisionInclude = {
  items: { orderBy: [{ kind: "asc" as const }, { position: "asc" as const }] },
  createdBy: {
    select: { id: true, displayName: true, email: true },
  },
} satisfies Prisma.TuningConfigRevisionInclude;

const tuningInclude = {
  activeRevision: { include: revisionInclude },
  revisions: {
    include: revisionInclude,
    orderBy: { revision: "desc" as const },
  },
  createdBy: {
    select: { id: true, displayName: true, email: true },
  },
  updatedBy: {
    select: { id: true, displayName: true, email: true },
  },
} satisfies Prisma.TuningConfigInclude;

type TuningRecord = Prisma.TuningConfigGetPayload<{
  include: typeof tuningInclude;
}>;
type TuningRevision = TuningRecord["revisions"][number];

function presentRevision(revision: TuningRevision) {
  return {
    id: revision.id,
    revision: revision.revision,
    beat: revision.beat,
    hardNos: revision.items
      .filter(({ kind }) => kind === "HARD_NO")
      .map(({ value }) => value),
    moreOf: revision.items
      .filter(({ kind }) => kind === "MORE_OF")
      .map(({ value }) => value),
    createdAt: revision.createdAt,
    finalizedAt: revision.finalizedAt,
    createdBy: revision.createdBy,
  };
}

function presentTuning(config: TuningRecord | null) {
  if (!config) {
    return {
      version: 1,
      active: null,
      history: [],
      metadata: null,
    };
  }
  return {
    version: config.version,
    active: config.activeRevision
      ? presentRevision(config.activeRevision)
      : null,
    history: config.revisions.map(presentRevision),
    metadata: {
      id: config.id,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      createdBy: config.createdBy,
      updatedBy: config.updatedBy,
    },
  };
}

export async function getTuning(database: PrismaClient, workspaceId: string) {
  const config = await database.tuningConfig.findUnique({
    where: { workspaceId },
    include: tuningInclude,
  });
  return presentTuning(config);
}

export async function updateTuning(
  database: PrismaClient,
  principal: AuthenticatedPrincipal,
  input: TuningUpdate,
) {
  try {
    return await database.$transaction(
      async (tx) => {
        let config = await tx.tuningConfig.findUnique({
          where: { workspaceId: principal.workspaceId },
          include: {
            revisions: {
              orderBy: { revision: "desc" },
              take: 1,
              select: { revision: true },
            },
          },
        });
        if (!config) {
          if (input.version !== 1) throw new TuningVersionConflictError();
          config = await tx.tuningConfig.create({
            data: {
              workspaceId: principal.workspaceId,
              createdById: principal.userId,
              updatedById: principal.userId,
              version: input.version,
            },
            include: {
              revisions: {
                orderBy: { revision: "desc" },
                take: 1,
                select: { revision: true },
              },
            },
          });
        } else if (config.version !== input.version) {
          throw new TuningVersionConflictError();
        }

        const revision = await tx.tuningConfigRevision.create({
          data: {
            tuningConfigId: config.id,
            revision: (config.revisions[0]?.revision ?? 0) + 1,
            beat: input.beat,
            createdById: principal.userId,
            items: {
              create: [
                ...input.hardNos.map((value, position) => ({
                  kind: "HARD_NO" as const,
                  position,
                  value,
                })),
                ...input.moreOf.map((value, position) => ({
                  kind: "MORE_OF" as const,
                  position,
                  value,
                })),
              ],
            },
          },
        });
        const finalizedAt = new Date();
        await tx.tuningConfigRevision.update({
          where: { id: revision.id },
          data: { finalizedAt },
        });
        const activated = await tx.tuningConfig.updateMany({
          where: { id: config.id, version: input.version },
          data: {
            activeRevisionId: revision.id,
            updatedById: principal.userId,
            version: { increment: 1 },
          },
        });
        if (activated.count !== 1) throw new TuningVersionConflictError();

        const result = await tx.tuningConfig.findUniqueOrThrow({
          where: { workspaceId: principal.workspaceId },
          include: tuningInclude,
        });
        return presentTuning(result);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      throw new TuningVersionConflictError();
    }
    throw error;
  }
}
