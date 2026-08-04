import {
  tasteLogCreateSchema,
  tasteLogQuerySchema,
} from "@/domain/api-contract";
import {
  apiErrorResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { prisma } from "@/server/db";
import {
  createTasteLogEntry,
  InvalidTasteLogCursorError,
  listTasteLog,
} from "@/server/taste/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    const parsed = tasteLogQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json(
      await listTasteLog(prisma, principal.workspaceId, parsed.data),
    );
  } catch (error) {
    if (error instanceof InvalidTasteLogCursorError) {
      return apiErrorResponse("INVALID_CURSOR", error.message, 400);
    }
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiErrorResponse(
        "INVALID_JSON",
        "The request body must be valid JSON.",
        400,
      );
    }
    const parsed = tasteLogCreateSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json(
      await createTasteLogEntry(prisma, principal, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
