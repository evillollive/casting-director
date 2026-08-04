import { authAdapter } from "@/server/auth";
import { requirePrincipal } from "@/server/auth/adapter";
import { routeErrorResponse } from "@/server/api/errors";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePrincipal(authAdapter(), request);
    const items = await prisma.source.findMany({
      where: { active: true, executable: true },
      orderBy: [{ family: "asc" }, { displayName: "asc" }],
      select: { key: true, displayName: true, family: true },
    });
    return Response.json({ items });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
