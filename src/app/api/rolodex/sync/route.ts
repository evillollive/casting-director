import { randomUUID } from "node:crypto";
import { rolodexSyncSchema } from "@/domain/api-contract";
import {
  apiErrorResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";
import { jsonBodyErrorResponse, readApiJson } from "@/server/api/body";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { prisma } from "@/server/db";
import { enqueueRepositorySync } from "@/server/sync/enqueue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    const [jobs, states, openConflicts] = await Promise.all([
      prisma.repositorySyncJob.findMany({
        where: { workspaceId: principal.workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          document: true,
          direction: true,
          status: true,
          attempt: true,
          maxAttempts: true,
          failureCode: true,
          lastError: true,
          repositoryRevision: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.markdownSyncState.findMany({
        where: { workspaceId: principal.workspaceId },
        orderBy: { document: "asc" },
        select: {
          document: true,
          lastImportedRepositoryRevision: true,
          lastExportedDatabaseRevision: true,
          lastImportedAt: true,
          lastExportedAt: true,
          lastDatabaseHash: true,
          lastRepositoryHash: true,
        },
      }),
      prisma.markdownSyncConflict.count({
        where: { syncState: { workspaceId: principal.workspaceId }, status: "OPEN" },
      }),
    ]);
    return Response.json({ jobs, states, openConflicts });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    let body: unknown;
    try {
      body = await readApiJson(request);
    } catch (error) {
      return jsonBodyErrorResponse(error);
    }
    const parsed = rolodexSyncSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    const suppliedKey = request.headers.get("idempotency-key")?.trim();
    if (suppliedKey && !/^[A-Za-z0-9._:-]{1,200}$/.test(suppliedKey)) {
      return apiErrorResponse(
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key must use 1-200 safe ASCII characters.",
        400,
      );
    }
    const requestKey = suppliedKey ?? randomUUID();
    const direction =
      parsed.data.action === "EXPORT" ? "EXPORT" : "IMPORT";
    const idempotencyKeys = parsed.data.documents.map(
      (document) =>
        `api:${requestKey}:${parsed.data.action}:${document}`,
    );
    await prisma.$transaction(async (tx) => {
      for (const [index, document] of parsed.data.documents.entries()) {
        await enqueueRepositorySync(tx, {
          workspaceId: principal.workspaceId,
          document,
          direction,
          idempotencyKey: idempotencyKeys[index]!,
        });
      }
    });
    const jobs = await prisma.repositorySyncJob.findMany({
      where: {
        workspaceId: principal.workspaceId,
        idempotencyKey: { in: idempotencyKeys },
      },
      orderBy: { document: "asc" },
      select: { id: true, document: true, direction: true, status: true },
    });
    return Response.json(
      {
        accepted: true,
        action: parsed.data.action,
        documents: parsed.data.documents,
        requestKey,
        jobs,
      },
      { status: 202 },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
