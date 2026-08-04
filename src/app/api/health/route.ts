import { CANONICAL_EDITORIAL_ARTIFACTS } from "@/domain/editorial-contract";
import { ConfigurationError, readRuntimeConfig } from "@/server/config";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const DATABASE_TIMEOUT_MS = 2_000;

async function checkDatabase(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database readiness check timed out.")),
          DATABASE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    readRuntimeConfig();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    return Response.json(
      {
        service: "casting-director-tier-2",
        ready: false,
        checks: { configuration: false, database: false },
        invalidConfiguration: Object.keys(error.fields),
        canonicalEditorialArtifacts: CANONICAL_EDITORIAL_ARTIFACTS,
      },
      { status: 503 },
    );
  }

  try {
    await checkDatabase();
  } catch (error) {
    console.error("Database readiness check failed.", error);
    return Response.json(
      {
        service: "casting-director-tier-2",
        ready: false,
        checks: { configuration: true, database: false },
        canonicalEditorialArtifacts: CANONICAL_EDITORIAL_ARTIFACTS,
      },
      { status: 503 },
    );
  }

  return Response.json({
    service: "casting-director-tier-2",
    ready: true,
    checks: { configuration: true, database: true },
    canonicalEditorialArtifacts: CANONICAL_EDITORIAL_ARTIFACTS,
  });
}
