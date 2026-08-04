import { z } from "zod";
import type { ApiErrorBody } from "@/domain/api-contract";
import { AuthenticationRequiredError } from "@/server/auth/adapter";
import { errorLogMessage } from "@/server/logging";

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

export function apiErrorResponse(
  code: string,
  message: string,
  status: number,
  fields?: Record<string, string[]>,
): Response {
  const body: ApiErrorBody = { error: { code, message, fields } };
  return Response.json(body, { status });
}

export function authenticationErrorResponse(): Response {
  return apiErrorResponse(
    "AUTHENTICATION_REQUIRED",
    "Authenticated team access is required.",
    401,
  );
}

export function routeErrorResponse(error: unknown): Response {
  if (error instanceof AuthenticationRequiredError) {
    return authenticationErrorResponse();
  }
  console.error("API request failed.", errorLogMessage(error));
  return apiErrorResponse(
    "INTERNAL_ERROR",
    "The request could not be completed.",
    500,
  );
}
