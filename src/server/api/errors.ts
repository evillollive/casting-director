import { z } from "zod";
import type { ApiErrorBody } from "@/domain/api-contract";

export function validationErrorResponse(error: z.ZodError): Response {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "request";
    fields[key] = [...(fields[key] ?? []), issue.message];
  }

  const body: ApiErrorBody = {
    error: {
      code: "VALIDATION_ERROR",
      message: "The request did not satisfy the API contract.",
      fields,
    },
  };
  return Response.json(body, { status: 400 });
}

export function conflictResponse(message: string): Response {
  const body: ApiErrorBody = {
    error: {
      code: "VERSION_CONFLICT",
      message,
    },
  };
  return Response.json(body, { status: 409 });
}
