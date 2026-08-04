import { tuningUpdateSchema } from "@/domain/api-contract";
import {
  conflictResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { prisma } from "@/server/db";
import {
  getTuning,
  TuningVersionConflictError,
  updateTuning,
} from "@/server/tuning/service";
import { jsonBodyErrorResponse, readApiJson } from "@/server/api/body";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    return Response.json(await getTuning(prisma, principal.workspaceId));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    let body: unknown;
    try {
      body = await readApiJson(request);
    } catch (error) {
      return jsonBodyErrorResponse(error);
    }
    const parsed = tuningUpdateSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json(await updateTuning(prisma, principal, parsed.data));
  } catch (error) {
    if (error instanceof TuningVersionConflictError) {
      return conflictResponse(error.message);
    }
    return routeErrorResponse(error);
  }
}
