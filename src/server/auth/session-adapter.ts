import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type {
  AuthAdapter,
  AuthenticationResult,
} from "@/server/auth/adapter";
import type { RuntimeConfig } from "@/server/config";

function sessionToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token || null;
  }

  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "casting_session") {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class DatabaseSessionAuthAdapter implements AuthAdapter {
  constructor(
    private readonly database: PrismaClient,
    private readonly config: Pick<RuntimeConfig, "CASTING_WORKSPACE_SLUG">,
  ) {}

  async authenticate(request: Request): Promise<AuthenticationResult> {
    const token = sessionToken(request);
    if (!token) return { authenticated: false };

    const session = await this.database.authSession.findFirst({
      where: {
        tokenHash: tokenHash(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: {
          active: true,
          memberships: {
            some: { workspace: { slug: this.config.CASTING_WORKSPACE_SLUG } },
          },
        },
      },
      select: {
        userId: true,
        user: {
          select: {
            memberships: {
              where: {
                workspace: { slug: this.config.CASTING_WORKSPACE_SLUG },
              },
              take: 1,
              select: { workspaceId: true, role: true },
            },
          },
        },
      },
    });
    const membership = session?.user.memberships[0];
    if (!session || !membership) return { authenticated: false };

    return {
      authenticated: true,
      principal: {
        userId: session.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
    };
  }

  async revokeSession(request: Request): Promise<void> {
    const token = sessionToken(request);
    if (!token) return;
    await this.database.authSession.updateMany({
      where: { tokenHash: tokenHash(token), revokedAt: null },
      data: { revokedAt: new Date(), version: { increment: 1 } },
    });
  }
}
