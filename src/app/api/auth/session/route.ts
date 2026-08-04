import { z } from "zod";
import { authAdapter } from "@/server/auth";
import {
  apiErrorResponse,
  routeErrorResponse,
  validationErrorResponse,
} from "@/server/api/errors";

const signInSchema = z.object({ token: z.string().trim().min(32).max(512) });

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiErrorResponse("INVALID_JSON", "The request body must be valid JSON.", 400);
    }
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    const result = await authAdapter().authenticate(
      new Request(request.url, {
        headers: { authorization: `Bearer ${parsed.data.token}` },
      }),
    );
    if (!result.authenticated) {
      return apiErrorResponse(
        "INVALID_SESSION",
        "The session token is invalid, expired, revoked, or lacks workspace access.",
        401,
      );
    }
    const response = Response.json({ authenticated: true });
    response.headers.append(
      "Set-Cookie",
      [
        `casting_session=${encodeURIComponent(parsed.data.token)}`,
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        "Max-Age=2592000",
        process.env.NODE_ENV === "production" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const adapter = authAdapter();
    await adapter.revokeSession(request);
    const response = Response.json({ authenticated: false });
    response.headers.set(
      "Set-Cookie",
      [
        "casting_session=",
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        "Max-Age=0",
        process.env.NODE_ENV === "production" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}
