import { syncConflictResolutionSchema } from "@/domain/api-contract";
import {
  apiErrorResponse,
  conflictResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import {
  readBoundedJson,
  RequestPayloadTooLargeError,
} from "@/server/api/body";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { readRuntimeConfig } from "@/server/config";
import { prisma } from "@/server/db";
import {
  resolveSyncConflict,
  SyncConflictNotFoundError,
  SyncConflictVersionError,
} from "@/server/sync/resolution";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await readBoundedJson(
        request,
        readRuntimeConfig().CASTING_MAX_REQUEST_BYTES,
      );
    } catch (error) {
      if (error instanceof RequestPayloadTooLargeError) {
        return apiErrorResponse("PAYLOAD_TOO_LARGE", error.message, 413);
      }
      return apiErrorResponse("INVALID_JSON", "The request body must be valid JSON.", 400);
    }
    const parsed = syncConflictResolutionSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json({
      conflict: await resolveSyncConflict(prisma, principal, id, parsed.data),
    });
  } catch (error) {
    if (error instanceof SyncConflictNotFoundError) {
      return apiErrorResponse("NOT_FOUND", error.message, 404);
    }
    if (error instanceof SyncConflictVersionError) {
      return conflictResponse(error.message);
    }
    return routeErrorResponse(error);
  }
}
