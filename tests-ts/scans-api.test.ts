import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/auth", () => ({
  authAdapter: () => ({
    authenticate: async () =>
      mocks.authenticated
        ? {
            authenticated: true as const,
            principal: {
              userId: "user-1",
              workspaceId: "workspace-1",
              role: "MEMBER" as const,
            },
          }
        : { authenticated: false as const },
    revokeSession: async () => undefined,
  }),
}));
vi.mock("@/server/scan/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/scan/service")>();
  return {
    ...actual,
    createOrGetActiveScan: mocks.create,
    listScans: mocks.list,
  };
});

import { GET, POST } from "@/app/api/scans/route";

describe("scan API", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.create.mockReset();
    mocks.list.mockReset();
  });

  it("returns 202 for an existing active scan without creating another", async () => {
    mocks.create.mockResolvedValue({
      created: false,
      scan: { id: "scan-active", status: "RUNNING" },
    });
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          runDate: "2026-08-04",
          sourceKeys: ["github"],
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: "scan-active",
      status: "RUNNING",
      created: false,
    });
  });

  it("requires authenticated workspace access", async () => {
    mocks.authenticated = false;
    const response = await GET(
      new Request("http://localhost/api/scans?limit=10"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("returns structured validation errors", async () => {
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runDate: "not-a-date", sourceKeys: [] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fields: {
          runDate: expect.any(Array),
          sourceKeys: expect.any(Array),
        },
      },
    });
  });
});
