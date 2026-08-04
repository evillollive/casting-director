import { routeErrorResponse } from "@/server/api/errors";
import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(authAdapter(), request);
    return Response.json({
      items: await prisma.markdownSyncConflict.findMany({
        where: {
          syncState: { workspaceId: principal.workspaceId },
          status: "OPEN",
        },
        include: { syncState: { select: { document: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
