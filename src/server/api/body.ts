export class RequestPayloadTooLargeError extends Error {
  constructor() {
    super("The request payload exceeds the configured limit.");
    this.name = "RequestPayloadTooLargeError";
  }
}

export async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new RequestPayloadTooLargeError();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RequestPayloadTooLargeError();
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const bytes = await readBoundedBody(request, maximumBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function configuredRequestLimit(
  environment: Record<string, string | undefined> = process.env,
): number {
  const value = Number(environment.CASTING_MAX_REQUEST_BYTES ?? "262144");
  return Number.isInteger(value) && value >= 1_024 && value <= 10_485_760
    ? value
    : 262_144;
}

export function readApiJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, configuredRequestLimit());
}

export function jsonBodyErrorResponse(error: unknown): Response {
  return error instanceof RequestPayloadTooLargeError
    ? apiErrorResponse("PAYLOAD_TOO_LARGE", error.message, 413)
    : apiErrorResponse(
        "INVALID_JSON",
        "The request body must be valid JSON.",
        400,
      );
}
import { apiErrorResponse } from "@/server/api/errors";
