import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyWebhookSignature } from "@/app/api/rolodex/webhook/route";
import {
  normalizeDnrIdentities,
  renderDoNotResurface,
  renderTasteLog,
} from "@/server/import/markdown-memory";
import { LocalGitRepositoryProvider } from "@/server/repository/local-git";
import { RepositoryRevisionConflictError } from "@/server/repository/provider";
import { redactLogText } from "@/server/logging";
import {
  retryOrFailRepositorySyncJob,
  type ClaimedRepositorySyncJob,
} from "@/server/sync/jobs";
import { reconcileSnapshots } from "@/server/sync/reconcile";
import {
  exportRepositoryDocument,
  RepositoryChangedError,
} from "@/server/sync/service";
import { enqueueRepositorySync } from "@/server/sync/enqueue";
import { resolveSyncConflict } from "@/server/sync/resolution";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("repository markdown sync", () => {
  it("uses the canonical Python evaluator normalization in one batch", () => {
    expect(
      normalizeDnrIdentities([
        " https://github.com/@OctoCat/ ",
        "  Ada   Lovelace ",
        "@@Ada",
      ]),
    ).toEqual(["octocat", "ada lovelace", "ada"]);
  });

  it("exports deterministic, public-safe markdown", () => {
    const dnr = renderDoNotResurface([
      {
        name: "@Zed",
        project: "Z | Lab",
        status: "PASSED",
        date: "2026-08-02",
        note: "Tracked by Tier 2.",
        normalizedIdentity: "zed",
      },
      {
        name: "@Ada",
        project: null,
        status: "CONTACTED",
        date: "2026-08-01",
        note: "Public note",
        normalizedIdentity: "ada",
      },
    ]);
    expect(dnr.indexOf("@Ada")).toBeLessThan(dnr.indexOf("@Zed"));
    expect(dnr).toContain("Z \\| Lab");
    expect(renderDoNotResurface([])).toBe(renderDoNotResurface([]));
    expect(
      renderTasteLog([
        { weekOf: "2026-08-01", note: "Older" },
        { weekOf: "2026-08-03", note: "Newer" },
      ]),
    ).toContain(
      "- _Week of 2026-08-03:_ Newer\n- _Week of 2026-08-01:_ Older",
    );
  });

  it("detects dual changes and never treats a markdown DNR deletion as an update", () => {
    const base = { ada: { name: "Ada", note: "base" } };
    expect(
      reconcileSnapshots(
        base,
        { ada: { name: "Ada", note: "database" } },
        { ada: { name: "Ada", note: "markdown" } },
      ).conflicts,
    ).toEqual([
      expect.objectContaining({ key: "ada", kind: "DUAL_CHANGE" }),
    ]);
    expect(reconcileSnapshots(base, base, {}).conflicts).toEqual([
      expect.objectContaining({ key: "ada", kind: "MARKDOWN_REMOVAL" }),
    ]);
    expect(reconcileSnapshots(base, base, {}).imports).toEqual([]);
  });

  it("writes local repository documents with optimistic revision checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "casting-repository-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "rolodex"));
    await writeFile(join(root, "rolodex/do-not-resurface.md"), "old\n");
    const provider = new LocalGitRepositoryProvider(root, false);
    const current = await provider.read("rolodex/do-not-resurface.md");
    const written = await provider.write({
      path: "rolodex/do-not-resurface.md",
      content: "new\n",
      expectedRevision: current.revision,
      message: "sync",
    });

    expect(written.content).toBe("new\n");
    await expect(
      provider.write({
        path: "rolodex/do-not-resurface.md",
        content: "stale\n",
        expectedRevision: current.revision,
        message: "sync",
      }),
    ).rejects.toBeInstanceOf(RepositoryRevisionConflictError);
  });

  it("refuses a first export until repository content has been reconciled", async () => {
    const provider = {
      read: vi.fn().mockResolvedValue({ content: "existing", revision: "repo-1" }),
      write: vi.fn(),
    };
    const database = {
      markdownSyncState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    await expect(
      exportRepositoryDocument(
        database,
        provider,
        "workspace-1",
        "DO_NOT_RESURFACE",
      ),
    ).rejects.toBeInstanceOf(RepositoryChangedError);
    expect(provider.write).not.toHaveBeenCalled();
  });

  it("uses durable idempotency keys and bounded retry state", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await enqueueRepositorySync(
      { repositorySyncJob: { createMany } } as never,
      {
        workspaceId: "workspace-1",
        document: "TASTE_LOG",
        direction: "EXPORT",
        idempotencyKey: "taste:entry-1:2",
      },
    );
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const job: ClaimedRepositorySyncJob = {
      id: "job-1",
      workspaceId: "workspace-1",
      document: "TASTE_LOG",
      direction: "EXPORT",
      attempt: 1,
      maxAttempts: 3,
      leaseToken: "lease",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    await expect(
      retryOrFailRepositorySyncJob(
        { repositorySyncJob: { updateMany } } as never,
        job,
        { code: "NETWORK", message: "retry", retryable: true },
      ),
    ).resolves.toBe("RETRY");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "READY" }),
      }),
    );
  });

  it("requires explicit conflict resolution before clearing DNR", async () => {
    const candidateUpdate = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        markdownSyncConflict: {
          findFirst: vi.fn().mockResolvedValue({
            id: "conflict-1",
            syncStateId: "state-1",
            normalizedIdentity: "ada",
            databaseSnapshot: {
              kind: "MARKDOWN_REMOVAL",
              candidateId: "candidate-1",
              candidateVersion: 1,
              entry: { name: "Ada" },
            },
            markdownSnapshot: { kind: "MARKDOWN_REMOVAL", deleted: true, entry: null },
            status: "OPEN",
            version: 1,
            syncState: {
              id: "state-1",
              workspaceId: "workspace-1",
              document: "DO_NOT_RESURFACE",
              baseSnapshot: { ada: { name: "Ada" } },
            },
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        candidate: {
          findFirst: vi.fn().mockResolvedValue({
            id: "candidate-1",
            handle: null,
            status: "PASSED",
            version: 1,
          }),
          updateMany: candidateUpdate.mockResolvedValue({ count: 1 }),
        },
        markdownSyncState: { update: vi.fn().mockResolvedValue({}) },
      }),
    );
    await resolveSyncConflict(
      { $transaction: transaction } as unknown as PrismaClient,
      { workspaceId: "workspace-1", userId: "user-1" },
      "conflict-1",
      { resolution: "MARKDOWN", version: 1 },
    );
    expect(candidateUpdate).toHaveBeenCalledWith({
      where: { id: "candidate-1", version: 1 },
      data: expect.objectContaining({ doNotResurface: false }),
    });
  });

  it("verifies webhook signatures without accepting malformed values", () => {
    const payload = new TextEncoder().encode('{"after":"abc"}');
    const secret = "a-secret-long-enough-for-production-use";
    const signature = `sha256=${createHmac("sha256", secret)
      .update(payload)
      .digest("hex")}`;
    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(payload, "sha256=bad", secret)).toBe(false);
    expect(verifyWebhookSignature(payload, signature, "")).toBe(false);
  });

  it("redacts common secret shapes from operational logs", () => {
    expect(
      redactLogText(
        "Bearer abc.def token=top-secret postgresql://user:password@db/casting",
      ),
    ).not.toMatch(/abc\.def|top-secret|password@/);
  });
});
