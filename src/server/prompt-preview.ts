import type { PrismaClient } from "@prisma/client";
import { runPromptPreview } from "@casting/python-bridge";
import { TASTE_LOG_INJECT_LIMIT } from "@/domain/editorial-contract";

export type TuningPreviewInput = {
  beat: string;
  hardNos: string[];
  moreOf: string[];
};

export class PromptPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptPreviewError";
  }
}

export async function generatePromptPreview(
  database: PrismaClient,
  workspaceId: string,
  tuning: TuningPreviewInput,
): Promise<string> {
  const [doNotResurface, tasteLog] = await Promise.all([
    database.candidate.findMany({
      where: { workspaceId, doNotResurface: true, mergedIntoId: null },
      orderBy: { name: "asc" },
      select: { name: true, handle: true, project: true },
    }),
    database.tasteLogEntry.findMany({
      where: { workspaceId },
      orderBy: [{ weekOf: "desc" }, { createdAt: "desc" }],
      take: TASTE_LOG_INJECT_LIMIT,
      select: { weekOf: true, note: true },
    }),
  ]);
  try {
    return await runPromptPreview(
      JSON.stringify({
        doNotResurface,
        tasteLog: tasteLog.map((entry) => ({
          weekOf: entry.weekOf.toISOString().slice(0, 10),
          note: entry.note,
        })),
        tuning,
      }),
    );
  } catch (error) {
    throw new PromptPreviewError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
