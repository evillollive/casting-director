import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  RepositoryRevisionConflictError,
  type RepositoryDocument,
  type RepositoryProvider,
  type RepositoryWrite,
} from "@/server/repository/provider";

function revision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class LocalGitRepositoryProvider implements RepositoryProvider {
  constructor(
    private readonly root: string,
    private readonly commitChanges: boolean,
  ) {}

  private filePath(path: string): string {
    const root = resolve(this.root);
    const file = resolve(root, path);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      throw new Error("Repository document path escapes the configured root.");
    }
    return file;
  }

  async read(path: string): Promise<RepositoryDocument> {
    const content = await readFile(this.filePath(path), "utf8");
    return { content, revision: revision(content) };
  }

  async write(input: RepositoryWrite): Promise<RepositoryDocument> {
    const current = await this.read(input.path);
    if (
      input.expectedRevision !== undefined &&
      current.revision !== input.expectedRevision
    ) {
      throw new RepositoryRevisionConflictError();
    }
    if (current.content === input.content) return current;

    const file = this.filePath(input.path);
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.casting-sync-${process.pid}`;
    await writeFile(temporary, input.content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);

    if (this.commitChanges) {
      const add = spawnSync("git", ["add", "--", input.path], {
        cwd: this.root,
        encoding: "utf8",
      });
      if (add.status !== 0) {
        throw new Error(`Repository staging failed: ${add.stderr.trim()}`);
      }
      const commit = spawnSync("git", ["commit", "-m", input.message, "--", input.path], {
        cwd: this.root,
        encoding: "utf8",
      });
      if (commit.status !== 0) {
        throw new Error(`Repository commit failed: ${commit.stderr.trim()}`);
      }
    }
    return { content: input.content, revision: revision(input.content) };
  }
}
