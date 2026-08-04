import { headers } from "next/headers";
import type { AuthenticatedPrincipal } from "@/server/auth/adapter";
import { authAdapter } from "@/server/auth";

export type PageAccess =
  | { state: "setup"; missing: string[] }
  | { state: "unauthenticated" }
  | { state: "authenticated"; principal: AuthenticatedPrincipal };

const requiredEnvironment = [
  "DATABASE_URL",
  "CASTING_APP_URL",
  "CASTING_AUTH_SECRET",
] as const;

export async function resolvePageAccess(): Promise<PageAccess> {
  const missing = requiredEnvironment.filter((key) => !process.env[key]);
  if (missing.length > 0) return { state: "setup", missing };

  const requestHeaders = new Headers(await headers());
  const result = await authAdapter().authenticate(
    new Request(process.env.CASTING_APP_URL!, { headers: requestHeaders }),
  );
  return result.authenticated
    ? { state: "authenticated", principal: result.principal }
    : { state: "unauthenticated" };
}
