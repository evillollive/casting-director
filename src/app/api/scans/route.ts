import { z } from "zod";
import {
  createScanSchema,
  scanQuerySchema,
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
  createOrGetActiveScan,
  listScans,
  UnknownScanSourcesError,
} from "@/server/scan/service";
import { jsonBodyErrorResponse, readApiJson } from "@/server/api/body";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    let body: unknown;
    try {
      body = await readApiJson(request);
    } catch (error) {
      return jsonBodyErrorResponse(error);
    }
    const parsed = createScanSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);

    const result = await createOrGetActiveScan(prisma, principal, parsed.data);
    return Response.json(
      {
        id: result.scan.id,
        status: result.scan.status,
        created: result.created,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof UnknownScanSourcesError) {
      return apiErrorResponse(
        "UNKNOWN_SCAN_SOURCE",
        error.message,
        400,
        { sourceKeys: error.sourceKeys },
      );
    }
    return routeErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    const url = new URL(request.url);
    const parsed = scanQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!parsed.success) return validationErrorResponse(parsed.error);
    return Response.json(
      await listScans(prisma, principal.workspaceId, parsed.data),
    );
  } catch (error) {
    if (error instanceof z.ZodError) return validationErrorResponse(error);
    return routeErrorResponse(error);
  }
}
