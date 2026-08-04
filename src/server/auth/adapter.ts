export type WorkspaceRole = "MEMBER" | "ADMIN";

export type AuthenticatedPrincipal = {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
};

export type AuthenticationResult =
  | { authenticated: true; principal: AuthenticatedPrincipal }
  | { authenticated: false };

export interface AuthAdapter {
  authenticate(request: Request): Promise<AuthenticationResult>;
  revokeSession(sessionId: string): Promise<void>;
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authenticated team access is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export async function requirePrincipal(
  adapter: AuthAdapter,
  request: Request,
): Promise<AuthenticatedPrincipal> {
  const result = await adapter.authenticate(request);
  if (!result.authenticated) {
    throw new AuthenticationRequiredError();
  }
  return result.principal;
}
