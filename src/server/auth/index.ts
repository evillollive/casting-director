import { DatabaseSessionAuthAdapter } from "@/server/auth/session-adapter";
import { readRuntimeConfig } from "@/server/config";
import { prisma } from "@/server/db";

let adapter: DatabaseSessionAuthAdapter | undefined;

export function authAdapter(): DatabaseSessionAuthAdapter {
  if (!adapter) {
    adapter = new DatabaseSessionAuthAdapter(prisma, readRuntimeConfig());
  }
  return adapter;
}
