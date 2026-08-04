import type {
  MarkdownDocumentKind,
  Prisma,
  RepositorySyncDirection,
} from "@prisma/client";

export async function enqueueRepositorySync(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    document: MarkdownDocumentKind;
    direction: RepositorySyncDirection;
    idempotencyKey: string;
    maxAttempts?: number;
  },
): Promise<void> {
  await tx.repositorySyncJob.createMany({
    data: [{
      workspaceId: input.workspaceId,
      document: input.document,
      direction: input.direction,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 5,
    }],
    skipDuplicates: true,
  });
}
