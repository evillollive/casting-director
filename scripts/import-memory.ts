import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient, SourceFamily, type Prisma } from "@prisma/client";
import { readRuntimeConfig } from "@/server/config";
import {
  parseDoNotResurface,
  parseTasteLog,
  type DoNotResurfaceRow,
  type TasteLogRow,
} from "@/server/import/markdown-memory";

type ImportOptions = {
  write: boolean;
  workspaceSlug: string;
  actorEmail?: string;
  dnrPath: string;
  tastePath: string;
};

function readOptions(arguments_: string[]): ImportOptions {
  const options: ImportOptions = {
    write: false,
    workspaceSlug: process.env.CASTING_WORKSPACE_SLUG ?? "casting",
    actorEmail: process.env.CASTING_IMPORT_USER_EMAIL,
    dnrPath: resolve("rolodex/do-not-resurface.md"),
    tastePath: resolve("rolodex/taste-log.md"),
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--workspace") options.workspaceSlug = value;
    else if (argument === "--actor") options.actorEmail = value;
    else if (argument === "--dnr") options.dnrPath = resolve(value);
    else if (argument === "--taste") options.tastePath = resolve(value);
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  return options;
}

async function importDnrRows(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  rows: DoNotResurfaceRow[],
): Promise<void> {
  const source = await prisma.source.upsert({
    where: { key: "markdown-memory" },
    update: {},
    create: {
      key: "markdown-memory",
      displayName: "Markdown memory",
      family: SourceFamily.OTHER,
    },
  });

  for (const row of rows) {
    const fingerprint = `markdown:${row.normalizedIdentity}`;
    const seenAt = row.date
      ? new Date(`${row.date}T00:00:00.000Z`)
      : new Date();
    const candidate = await prisma.candidate.upsert({
      where: {
        workspaceId_fingerprint: { workspaceId, fingerprint },
      },
      update: {
        name: row.name,
        project: row.project,
        status: row.status,
        doNotResurface: true,
        lastSeenAt: seenAt,
        version: { increment: 1 },
      },
      create: {
        workspaceId,
        fingerprint,
        name: row.name,
        project: row.project,
        status: row.status,
        doNotResurface: true,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      },
    });

    await prisma.candidateProvenance.upsert({
      where: {
        workspaceId_sourceId_fingerprint: {
          workspaceId,
          sourceId: source.id,
          fingerprint,
        },
      },
      update: {
        candidateId: candidate.id,
        lastSeenAt: seenAt,
        rawMetadata: { note: row.note, importedStatus: row.status },
        version: { increment: 1 },
      },
      create: {
        candidateId: candidate.id,
        workspaceId,
        sourceId: source.id,
        sourceUrl: "rolodex/do-not-resurface.md",
        fingerprint,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        rawMetadata: { note: row.note, importedStatus: row.status },
      },
    });
  }
}

async function importTasteRows(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  rows: TasteLogRow[],
): Promise<void> {
  for (const row of rows) {
    const weekOf = new Date(`${row.weekOf}T00:00:00.000Z`);
    const existing = await prisma.tasteLogEntry.findFirst({
      where: { workspaceId, weekOf, note: row.note },
      select: { id: true },
    });
    if (existing) continue;

    const entry = await prisma.tasteLogEntry.create({
      data: {
        workspaceId,
        weekOf,
        note: row.note,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    await prisma.tasteLogEntryRevision.create({
      data: {
        tasteLogEntryId: entry.id,
        revision: 1,
        note: row.note,
        editedById: actorId,
      },
    });
  }
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const [dnrMarkdown, tasteMarkdown] = await Promise.all([
    readFile(options.dnrPath, "utf8"),
    readFile(options.tastePath, "utf8"),
  ]);
  const dnrRows = parseDoNotResurface(dnrMarkdown);
  const tasteRows = parseTasteLog(tasteMarkdown);

  if (!options.write) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          workspace: options.workspaceSlug,
          doNotResurface: dnrRows,
          tasteLog: tasteRows,
        },
        null,
        2,
      ),
    );
    return;
  }

  readRuntimeConfig();
  if (tasteRows.length > 0 && !options.actorEmail) {
    throw new Error(
      "--actor or CASTING_IMPORT_USER_EMAIL is required to import taste-log rows.",
    );
  }

  const prisma = new PrismaClient();
  try {
    const actor = options.actorEmail
      ? await prisma.user.findUnique({
          where: { email: options.actorEmail },
          select: { id: true, active: true },
        })
      : null;
    if (options.actorEmail && (!actor || !actor.active)) {
      throw new Error(`No active import user exists for ${options.actorEmail}.`);
    }

    await prisma.$transaction(async (transaction) => {
      const workspace = await transaction.workspace.upsert({
        where: { slug: options.workspaceSlug },
        update: {},
        create: {
          slug: options.workspaceSlug,
          name: options.workspaceSlug,
        },
      });
      if (actor) {
        const [membership, membershipCount] = await Promise.all([
          transaction.workspaceMembership.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: workspace.id,
                userId: actor.id,
              },
            },
            select: { id: true },
          }),
          transaction.workspaceMembership.count({
            where: { workspaceId: workspace.id },
          }),
        ]);
        if (!membership && membershipCount > 0) {
          throw new Error(
            `${options.actorEmail} is not a member of workspace ${workspace.slug}.`,
          );
        }
        if (!membership) {
          await transaction.workspaceMembership.create({
            data: {
              workspaceId: workspace.id,
              userId: actor.id,
              role: "ADMIN",
            },
          });
        }
      }
      await importDnrRows(transaction, workspace.id, dnrRows);
      if (actor) {
        await importTasteRows(
          transaction,
          workspace.id,
          actor.id,
          tasteRows,
        );
      }
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `Imported ${dnrRows.length} do-not-resurface rows and ${tasteRows.length} taste-log rows.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
