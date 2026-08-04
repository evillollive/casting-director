import { createHmac, timingSafeEqual } from "node:crypto";
import { apiErrorResponse, routeErrorResponse } from "@/server/api/errors";
import {
  readBoundedBody,
  RequestPayloadTooLargeError,
} from "@/server/api/body";
import { readRuntimeConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { enqueueRepositorySync } from "@/server/sync/enqueue";

export const dynamic = "force-dynamic";

const paths = {
  "rolodex/do-not-resurface.md": "DO_NOT_RESURFACE",
  "rolodex/taste-log.md": "TASTE_LOG",
} as const;

export function verifyWebhookSignature(
  payload: Uint8Array,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !signature.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(payload).digest("hex"),
    "utf8",
  );
  const supplied = Buffer.from(signature.slice(7), "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function POST(request: Request) {
  try {
    const config = readRuntimeConfig();
    let payload: Uint8Array;
    try {
      payload = await readBoundedBody(request, config.CASTING_MAX_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestPayloadTooLargeError) {
        return apiErrorResponse("PAYLOAD_TOO_LARGE", error.message, 413);
      }
      throw error;
    }
    if (
      !verifyWebhookSignature(
        payload,
        request.headers.get("x-hub-signature-256") ?? "",
        config.CASTING_WEBHOOK_SECRET,
      )
    ) {
      return apiErrorResponse("INVALID_WEBHOOK_SIGNATURE", "Webhook signature verification failed.", 401);
    }
    const event = request.headers.get("x-github-event");
    if (event !== "push") return Response.json({ accepted: false, reason: "ignored_event" });
    const body = JSON.parse(new TextDecoder().decode(payload)) as {
      after?: unknown;
      commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>;
    };
    if (typeof body.after !== "string" || !Array.isArray(body.commits)) {
      return apiErrorResponse("INVALID_WEBHOOK_PAYLOAD", "Webhook payload is missing push revision data.", 400);
    }
    const changed = new Set(
      body.commits.flatMap((commit) => [
        ...(commit.added ?? []),
        ...(commit.modified ?? []),
        ...(commit.removed ?? []),
      ]),
    );
    const documents = Object.entries(paths).flatMap(([path, document]) =>
      changed.has(path) ? [document] : [],
    );
    if (documents.length === 0) return Response.json({ accepted: false, reason: "no_sync_documents" });
    const workspace = await prisma.workspace.findUnique({
      where: { slug: config.CASTING_WORKSPACE_SLUG },
      select: { id: true },
    });
    if (!workspace) {
      return apiErrorResponse("WORKSPACE_NOT_FOUND", "Configured workspace does not exist.", 503);
    }
    const delivery = request.headers.get("x-github-delivery") || body.after;
    await prisma.$transaction(async (tx) => {
      for (const document of documents) {
        await enqueueRepositorySync(tx, {
          workspaceId: workspace.id,
          document,
          direction: "IMPORT",
          idempotencyKey: `webhook:${delivery}:${document}`,
        });
      }
    });
    return Response.json({ accepted: true, documents }, { status: 202 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return apiErrorResponse("INVALID_WEBHOOK_PAYLOAD", "Webhook payload must be valid JSON.", 400);
    }
    return routeErrorResponse(error);
  }
}
