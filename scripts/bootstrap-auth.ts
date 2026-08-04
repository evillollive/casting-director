import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { readRuntimeConfig } from "@/server/config";

type Options = {
  email: string;
  displayName: string;
  workspaceName?: string;
  days: number;
};

function readOptions(arguments_: string[]): Options {
  const values = new Map<string, string>();
  const supported = new Set(["--email", "--name", "--workspace-name", "--days"]);
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!supported.has(name)) throw new Error(`Unknown option: ${name}`);
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    values.set(name, value);
  }
  const email = values.get("--email")?.trim().toLowerCase();
  const displayName = values.get("--name")?.trim();
  const workspaceName = values.get("--workspace-name")?.trim();
  const days = Number(values.get("--days") ?? "30");
  if (!email || !email.includes("@")) {
    throw new Error("--email must be a valid email address.");
  }
  if (!displayName) throw new Error("--name is required.");
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("--days must be an integer from 1 to 365.");
  }
  return { email, displayName, workspaceName, days };
}

async function main(): Promise<void> {
  const config = readRuntimeConfig();
  const options = readOptions(process.argv.slice(2));
  const database = new PrismaClient();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + options.days * 86_400_000);

  try {
    const result = await database.$transaction(async (transaction) => {
      const workspace = await transaction.workspace.upsert({
        where: { slug: config.CASTING_WORKSPACE_SLUG },
        update: options.workspaceName ? { name: options.workspaceName } : {},
        create: {
          slug: config.CASTING_WORKSPACE_SLUG,
          name: options.workspaceName ?? config.CASTING_WORKSPACE_SLUG,
        },
      });
      const membershipCount = await transaction.workspaceMembership.count({
        where: { workspaceId: workspace.id },
      });
      const user = await transaction.user.upsert({
        where: { email: options.email },
        update: { displayName: options.displayName, active: true },
        create: { email: options.email, displayName: options.displayName },
      });
      await transaction.workspaceMembership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: user.id,
          },
        },
        update: {},
        create: {
          workspaceId: workspace.id,
          userId: user.id,
          role: membershipCount === 0 ? "ADMIN" : "MEMBER",
        },
      });
      await transaction.authSession.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
      return { workspace, user, firstMember: membershipCount === 0 };
    });

    console.log(
      JSON.stringify(
        {
          workspace: result.workspace.slug,
          user: result.user.email,
          role: result.firstMember ? "ADMIN" : "MEMBER",
          expiresAt: expiresAt.toISOString(),
          signInUrl: `${config.CASTING_APP_URL}/sign-in`,
          token,
        },
        null,
        2,
      ),
    );
    console.error("Store the token securely. It is shown only in this output.");
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
