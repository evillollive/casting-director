import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  authenticate: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  authAdapter: () => ({
    authenticate: mocks.authenticate,
    revokeSession: mocks.revokeSession,
  }),
}));

import { DELETE, POST } from "@/app/api/auth/session/route";

describe("session sign in API", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.authenticate.mockReset();
    mocks.revokeSession.mockReset();
    mocks.authenticate.mockImplementation(async () =>
      mocks.authenticated
        ? {
            authenticated: true as const,
            principal: {
              userId: "user-1",
              workspaceId: "workspace-1",
              role: "ADMIN" as const,
            },
          }
        : { authenticated: false as const },
    );
  });

  it("sets an HTTP-only same-site cookie only after adapter authentication", async () => {
    const token = "t".repeat(40);
    const response = await POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  it("marks the session cookie secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(
      new Request("https://casting.example/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "t".repeat(40) }),
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("Secure");
    vi.unstubAllEnvs();
  });

  it("does not create a cookie for an invalid or unauthorized token", async () => {
    mocks.authenticated = false;
    const response = await POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "t".repeat(40) }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the browser cookie on sign out", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: "casting_session=token" },
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.revokeSession).toHaveBeenCalledWith(expect.any(Request));
  });

  it("does not report sign out success when server revocation fails", async () => {
    mocks.revokeSession.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await DELETE(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: "casting_session=token" },
      }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
