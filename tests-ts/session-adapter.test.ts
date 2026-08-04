import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DatabaseSessionAuthAdapter } from "@/server/auth/session-adapter";

describe("database session auth adapter", () => {
  it("authenticates an active workspace session without a fallback identity", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      userId: "user-1",
      user: {
        memberships: [
          { workspaceId: "workspace-1", role: "MEMBER" },
        ],
      },
    });
    const adapter = new DatabaseSessionAuthAdapter(
      { authSession: { findFirst } } as never,
      { CASTING_WORKSPACE_SLUG: "casting" },
    );
    const result = await adapter.authenticate(
      new Request("http://localhost", {
        headers: { authorization: "Bearer " + "session-token" },
      }),
    );
    expect(result).toEqual({
      authenticated: true,
      principal: {
        userId: "user-1",
        workspaceId: "workspace-1",
        role: "MEMBER",
      },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: createHash("sha256").update("session-token").digest("hex"),
          revokedAt: null,
        }),
      }),
    );
  });

  it("revokes the exact cookie session token", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const adapter = new DatabaseSessionAuthAdapter(
      { authSession: { updateMany } } as never,
      { CASTING_WORKSPACE_SLUG: "casting" },
    );
    await adapter.revokeSession(
      new Request("http://localhost", {
        headers: { cookie: "casting_session=revocable-token" },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: createHash("sha256")
          .update("revocable-token")
          .digest("hex"),
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
        version: { increment: 1 },
      },
    });
  });
});
