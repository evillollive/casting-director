import {
  apiErrorResponse,
  routeErrorResponse,
} from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { prisma } from "@/server/db";
import { getScan, ScanNotFoundError } from "@/server/scan/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    const { id } = await context.params;
    return Response.json(await getScan(prisma, principal.workspaceId, id));
  } catch (error) {
    if (error instanceof ScanNotFoundError) {
      return apiErrorResponse("SCAN_NOT_FOUND", error.message, 404);
    }
    return routeErrorResponse(error);
  }
}
