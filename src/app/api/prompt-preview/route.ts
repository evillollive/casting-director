import { z } from "zod";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import {
  apiErrorResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { prisma } from "@/server/db";
import {
  generatePromptPreview,
  PromptPreviewError,
} from "@/server/prompt-preview";
import { jsonBodyErrorResponse, readApiJson } from "@/server/api/body";

const previewSchema = z.object({
  beat: z.string().trim().max(4_000),
  hardNos: z.array(z.string().trim().min(1).max(1_000)).max(100),
  moreOf: z.array(z.string().trim().min(1).max(1_000)).max(100),
});

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    let body: unknown;
    try {
      body = await readApiJson(request);
    } catch (error) {
      return jsonBodyErrorResponse(error);
    }
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json({
      prompt: await generatePromptPreview(prisma, principal.workspaceId, parsed.data),
    });
  } catch (error) {
    if (error instanceof PromptPreviewError) {
      return apiErrorResponse("PROMPT_PREVIEW_FAILED", error.message, 502);
    }
    return routeErrorResponse(error);
  }
}
