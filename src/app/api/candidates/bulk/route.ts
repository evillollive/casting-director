import { candidateBulkPatchSchema } from "@/domain/api-contract";
import {
  apiErrorResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import {
  bulkUpdateCandidates,
  CandidateBulkConflictError,
  CandidateNotFoundError,
  CandidateTagsNotFoundError,
} from "@/server/candidate/service";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

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
    const parsed = candidateBulkPatchSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json(
      await bulkUpdateCandidates(prisma, principal, parsed.data),
    );
  } catch (error) {
    if (error instanceof CandidateNotFoundError) {
      return apiErrorResponse("CANDIDATE_NOT_FOUND", error.message, 404, {
        candidateIds: error.candidateIds,
      });
    }
    if (error instanceof CandidateTagsNotFoundError) {
      return apiErrorResponse("TAG_NOT_FOUND", error.message, 400, {
        tagIds: error.tagIds,
      });
    }
    if (error instanceof CandidateBulkConflictError) {
      return apiErrorResponse("BULK_CONFLICT", error.message, 409);
    }
    return routeErrorResponse(error);
  }
}
