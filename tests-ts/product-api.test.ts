import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  listCandidates: vi.fn(),
  updateCandidate: vi.fn(),
  bulkUpdateCandidates: vi.fn(),
  getTuning: vi.fn(),
  updateTuning: vi.fn(),
  listTasteLog: vi.fn(),
  createTasteLogEntry: vi.fn(),
  updateTasteLogEntry: vi.fn(),
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
vi.mock("@/server/candidate/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/candidate/service")>()),
  listCandidates: mocks.listCandidates,
  updateCandidate: mocks.updateCandidate,
  bulkUpdateCandidates: mocks.bulkUpdateCandidates,
}));
vi.mock("@/server/tuning/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/tuning/service")>()),
  getTuning: mocks.getTuning,
  updateTuning: mocks.updateTuning,
}));
vi.mock("@/server/taste/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/taste/service")>()),
  listTasteLog: mocks.listTasteLog,
  createTasteLogEntry: mocks.createTasteLogEntry,
  updateTasteLogEntry: mocks.updateTasteLogEntry,
}));

import { GET as getCandidates } from "@/app/api/candidates/route";
import { PATCH as patchCandidate } from "@/app/api/candidates/[id]/route";
import { POST as bulkCandidates } from "@/app/api/candidates/bulk/route";
import { GET as getTuning, PUT as putTuning } from "@/app/api/tuning/route";
import {
  GET as getTasteLog,
  POST as postTasteLog,
} from "@/app/api/taste-log/route";
import { PATCH as patchTasteLog } from "@/app/api/taste-log/[id]/route";
import {
  CandidateVersionConflictError,
} from "@/server/candidate/service";
import { TasteLogVersionConflictError } from "@/server/taste/service";
import { TuningVersionConflictError } from "@/server/tuning/service";

const candidateContext = { params: Promise.resolve({ id: "candidate-1" }) };
const tasteContext = { params: Promise.resolve({ id: "taste-1" }) };

function request(path: string, method = "GET", body?: string) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body,
  });
}

describe("authenticated product APIs", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    for (const value of Object.values(mocks)) {
      if (typeof value === "function" && "mockReset" in value) {
        value.mockReset();
      }
    }
    mocks.listCandidates.mockResolvedValue({ items: [], nextCursor: null });
    mocks.updateCandidate.mockResolvedValue({ id: "candidate-1" });
    mocks.bulkUpdateCandidates.mockResolvedValue({ updatedCount: 1 });
    mocks.getTuning.mockResolvedValue({
      version: 1,
      active: null,
      history: [],
      metadata: null,
    });
    mocks.updateTuning.mockResolvedValue({ version: 1 });
    mocks.listTasteLog.mockResolvedValue({ items: [], nextCursor: null });
    mocks.createTasteLogEntry.mockResolvedValue({ id: "taste-1" });
    mocks.updateTasteLogEntry.mockResolvedValue({ id: "taste-1" });
  });

  it("requires authentication before every product API operation", async () => {
    mocks.authenticated = false;
    const responses = await Promise.all([
      getCandidates(request("/api/candidates")),
      patchCandidate(request("/api/candidates/candidate-1", "PATCH", "{}"), candidateContext),
      bulkCandidates(request("/api/candidates/bulk", "POST", "{}")),
      getTuning(request("/api/tuning")),
      putTuning(request("/api/tuning", "PUT", "{}")),
      getTasteLog(request("/api/taste-log")),
      postTasteLog(request("/api/taste-log", "POST", "{}")),
      patchTasteLog(request("/api/taste-log/taste-1", "PATCH", "{}"), tasteContext),
    ]);
    expect(responses.map(({ status }) => status)).toEqual(
      Array(8).fill(401),
    );
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "AUTHENTICATION_REQUIRED" },
      });
    }
  });

  it("passes parsed candidate filters and principal workspace to the service", async () => {
    await getCandidates(
      request(
        "/api/candidates?query=ada&status=NEW&sourceFamily=CODE_HOST&minimumOverallScore=4&gatePassed=false&limit=10",
      ),
    );
    expect(mocks.listCandidates).toHaveBeenCalledWith(
      {},
      "workspace-1",
      expect.objectContaining({
        query: "ada",
        status: "NEW",
        sourceFamily: "CODE_HOST",
        minimumOverallScore: 4,
        gatePassed: false,
        limit: 10,
        sort: "updatedAt",
        direction: "desc",
      }),
    );
  });

  it("returns structured validation errors for invalid writes", async () => {
    const responses = await Promise.all([
      patchCandidate(
        request(
          "/api/candidates/candidate-1",
          "PATCH",
          JSON.stringify({ status: "CONTACTED" }),
        ),
        candidateContext,
      ),
      bulkCandidates(
        request(
          "/api/candidates/bulk",
          "POST",
          JSON.stringify({
            candidateIds: ["candidate-1", "candidate-1"],
            doNotResurface: true,
          }),
        ),
      ),
      putTuning(
        request(
          "/api/tuning",
          "PUT",
          JSON.stringify({ version: -1, beat: "", hardNos: [], moreOf: [] }),
        ),
      ),
      postTasteLog(
        request(
          "/api/taste-log",
          "POST",
          JSON.stringify({ weekOf: "not-a-date", note: "" }),
        ),
      ),
      patchTasteLog(
        request(
          "/api/taste-log/taste-1",
          "PATCH",
          JSON.stringify({ version: 0, note: "" }),
        ),
        tasteContext,
      ),
    ]);
    expect(responses.map(({ status }) => status)).toEqual(
      Array(5).fill(400),
    );
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR", fields: expect.any(Object) },
      });
    }
  });

  it("handles malformed JSON consistently on every write endpoint", async () => {
    const responses = await Promise.all([
      patchCandidate(
        request("/api/candidates/candidate-1", "PATCH", "{"),
        candidateContext,
      ),
      bulkCandidates(request("/api/candidates/bulk", "POST", "{")),
      putTuning(request("/api/tuning", "PUT", "{")),
      postTasteLog(request("/api/taste-log", "POST", "{")),
      patchTasteLog(
        request("/api/taste-log/taste-1", "PATCH", "{"),
        tasteContext,
      ),
    ]);
    expect(responses.map(({ status }) => status)).toEqual(
      Array(5).fill(400),
    );
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_JSON" },
      });
    }
  });

  it("maps optimistic concurrency failures to structured conflicts", async () => {
    mocks.updateCandidate.mockRejectedValue(
      new CandidateVersionConflictError(),
    );
    mocks.updateTuning.mockRejectedValue(new TuningVersionConflictError());
    mocks.updateTasteLogEntry.mockRejectedValue(
      new TasteLogVersionConflictError(),
    );
    const responses = await Promise.all([
      patchCandidate(
        request(
          "/api/candidates/candidate-1",
          "PATCH",
          JSON.stringify({ version: 2, status: "CONTACTED" }),
        ),
        candidateContext,
      ),
      putTuning(
        request(
          "/api/tuning",
          "PUT",
          JSON.stringify({
            version: 2,
            beat: "Human stories",
            hardNos: [],
            moreOf: [],
          }),
        ),
      ),
      patchTasteLog(
        request(
          "/api/taste-log/taste-1",
          "PATCH",
          JSON.stringify({ version: 2, note: "Updated note" }),
        ),
        tasteContext,
      ),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([409, 409, 409]);
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VERSION_CONFLICT" },
      });
    }
  });
});
