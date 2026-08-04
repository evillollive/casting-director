import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
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

function runPreview(payload: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.env.CASTING_PYTHON_BIN ?? "python3",
      [
        join(
          /*turbopackIgnore: true*/ process.cwd(),
          "tools",
          "tier2_prompt_preview.py",
        ),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new PromptPreviewError(stderr.trim() || `Prompt preview exited with ${code}.`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as { prompt?: unknown };
        if (typeof result.prompt !== "string") {
          reject(new PromptPreviewError("Prompt preview returned an invalid response."));
          return;
        }
        resolvePromise(result.prompt);
      } catch {
        reject(new PromptPreviewError("Prompt preview returned malformed JSON."));
      }
    });
    child.stdin.end(payload);
  });
}

export async function generatePromptPreview(
  database: PrismaClient,
  workspaceId: string,
  tuning: TuningPreviewInput,
): Promise<string> {
  const [template, doNotResurface, tasteLog] = await Promise.all([
    readFile(
      join(process.cwd(), "prompts", "tier0-weekly-scan.md"),
      "utf8",
    ),
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
  return runPreview(
    JSON.stringify({
      template,
      doNotResurface,
      tasteLog: tasteLog.map((entry) => ({
        weekOf: entry.weekOf.toISOString().slice(0, 10),
        note: entry.note,
      })),
      tuning,
    }),
  );
}
