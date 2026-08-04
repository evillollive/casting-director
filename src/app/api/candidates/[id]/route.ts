import { candidatePatchSchema } from "@/domain/api-contract";
import {
  apiErrorResponse,
  conflictResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import {
  CandidateNotFoundError,
  CandidateTagsNotFoundError,
  CandidateVersionConflictError,
  updateCandidate,
} from "@/server/candidate/service";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
    const parsed = candidatePatchSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    const { id } = await context.params;
    return Response.json({
      item: await updateCandidate(prisma, principal, id, parsed.data),
    });
  } catch (error) {
    if (error instanceof CandidateNotFoundError) {
      return apiErrorResponse("CANDIDATE_NOT_FOUND", error.message, 404);
    }
    if (error instanceof CandidateTagsNotFoundError) {
      return apiErrorResponse("TAG_NOT_FOUND", error.message, 400, {
        tagIds: error.tagIds,
      });
    }
    if (error instanceof CandidateVersionConflictError) {
      return conflictResponse(error.message);
    }
    return routeErrorResponse(error);
  }
}
