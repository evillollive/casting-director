import { tasteLogPatchSchema } from "@/domain/api-contract";
import {
  apiErrorResponse,
  conflictResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { prisma } from "@/server/db";
import {
  TasteLogNotFoundError,
  TasteLogVersionConflictError,
  updateTasteLogEntry,
} from "@/server/taste/service";
import { jsonBodyErrorResponse, readApiJson } from "@/server/api/body";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    let body: unknown;
    try {
      body = await readApiJson(request);
    } catch (error) {
      return jsonBodyErrorResponse(error);
    }
    const parsed = tasteLogPatchSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    const { id } = await context.params;
    return Response.json(
      await updateTasteLogEntry(prisma, principal, id, parsed.data),
    );
  } catch (error) {
    if (error instanceof TasteLogNotFoundError) {
      return apiErrorResponse("TASTE_LOG_NOT_FOUND", error.message, 404);
    }
    if (error instanceof TasteLogVersionConflictError) {
      return conflictResponse(error.message);
    }
    return routeErrorResponse(error);
  }
}
