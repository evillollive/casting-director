import { candidateQuerySchema } from "@/domain/api-contract";
import {
  apiErrorResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import {
  InvalidCandidateCursorError,
  listCandidates,
} from "@/server/candidate/service";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    const parsed = candidateQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json(
      await listCandidates(prisma, principal.workspaceId, parsed.data),
    );
  } catch (error) {
    if (error instanceof InvalidCandidateCursorError) {
      return apiErrorResponse("INVALID_CURSOR", error.message, 400);
    }
    return routeErrorResponse(error);
  }
}
