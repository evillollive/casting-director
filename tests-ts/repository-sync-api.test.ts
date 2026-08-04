import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  enqueueRepositorySync: vi.fn(),
  resolveSyncConflict: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: {
    $transaction: async (callback: (tx: object) => unknown) => callback({}),
    markdownSyncConflict: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    repositorySyncJob: { findMany: vi.fn().mockResolvedValue([]) },
    markdownSyncState: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/server/config", () => ({
  readRuntimeConfig: () => ({
    CASTING_MAX_REQUEST_BYTES: 262_144,
    CASTING_REPOSITORY_PROVIDER: "local",
  }),
}));
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
  }),
}));
vi.mock("@/server/sync/resolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sync/resolution")>()),
  resolveSyncConflict: mocks.resolveSyncConflict,
}));
vi.mock("@/server/sync/enqueue", () => ({
  enqueueRepositorySync: mocks.enqueueRepositorySync,
}));

import { GET as getConflicts } from "@/app/api/rolodex/conflicts/route";
import { POST as resolveConflict } from "@/app/api/rolodex/conflicts/[id]/resolve/route";
import {
  GET as getSyncStatus,
  POST as syncRolodex,
} from "@/app/api/rolodex/sync/route";

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("authenticated repository sync API", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.enqueueRepositorySync.mockReset().mockResolvedValue(undefined);
    mocks.resolveSyncConflict.mockReset().mockResolvedValue({
      id: "conflict-1",
      resolution: "DATABASE",
    });
  });

  it("requires team authentication for sync, listing, and resolution", async () => {
    mocks.authenticated = false;
    const responses = await Promise.all([
      syncRolodex(request("/api/rolodex/sync", "POST", {})),
      getSyncStatus(request("/api/rolodex/sync")),
      getConflicts(request("/api/rolodex/conflicts")),
      resolveConflict(
        request("/api/rolodex/conflicts/conflict-1/resolve", "POST", {
          resolution: "DATABASE",
          version: 1,
        }),
        { params: Promise.resolve({ id: "conflict-1" }) },
      ),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([401, 401, 401, 401]);
  });

  it("queues durable reconciliation for both documents by default", async () => {
    const response = await syncRolodex(
      request("/api/rolodex/sync", "POST", { action: "RECONCILE" }),
    );
    expect(response.status).toBe(202);
    expect(mocks.enqueueRepositorySync).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueRepositorySync).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workspaceId: "workspace-1",
        document: "DO_NOT_RESURFACE",
        direction: "IMPORT",
      }),
    );
  });

  it("routes explicit human conflict resolution", async () => {
    const response = await resolveConflict(
      request("/api/rolodex/conflicts/conflict-1/resolve", "POST", {
        resolution: "MARKDOWN",
        version: 3,
      }),
      { params: Promise.resolve({ id: "conflict-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.resolveSyncConflict).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ userId: "user-1" }),
      "conflict-1",
      { resolution: "MARKDOWN", version: 3 },
    );
  });

  it("returns authenticated operational sync status", async () => {
    const response = await getSyncStatus(request("/api/rolodex/sync"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [],
      states: [],
      openConflicts: 0,
    });
  });

  it("bounds sync request payloads", async () => {
    const response = await syncRolodex(
      request("/api/rolodex/sync", "POST", {
        action: "RECONCILE",
        padding: "x".repeat(300_000),
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});
