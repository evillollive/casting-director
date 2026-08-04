import {
  RepositoryRevisionConflictError,
  type RepositoryDocument,
  type RepositoryProvider,
  type RepositoryWrite,
} from "@/server/repository/provider";

type GitHubContent = {
  content?: string;
  encoding?: string;
  sha?: string;
};

export class GitHubRepositoryProvider implements RepositoryProvider {
  constructor(
    private readonly apiUrl: string,
    private readonly repository: string,
    private readonly branch: string,
    private readonly token: string,
  ) {
    if (!/^[^/]+\/[^/]+$/.test(repository) || !token) {
      throw new Error(
        "GitHub repository integration requires CASTING_GITHUB_REPOSITORY and CASTING_GITHUB_TOKEN.",
      );
    }
  }

  private url(path: string): string {
    return `${this.apiUrl.replace(/\/$/, "")}/repos/${this.repository}/contents/${path}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(this.url(path), {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        ...init?.headers,
      },
    });
  }

  async read(path: string): Promise<RepositoryDocument> {
    const response = await this.request(
      `${path}?ref=${encodeURIComponent(this.branch)}`,
    );
    if (!response.ok) {
      throw new Error(`GitHub repository read failed with HTTP ${response.status}.`);
    }
    const body = (await response.json()) as GitHubContent;
    if (body.encoding !== "base64" || !body.content || !body.sha) {
      throw new Error("GitHub repository returned an invalid document response.");
    }
    return {
      content: Buffer.from(body.content.replace(/\s+/g, ""), "base64").toString("utf8"),
      revision: body.sha,
    };
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
    const response = await this.request(input.path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        sha: current.revision,
        branch: this.branch,
      }),
    });
    if (response.status === 409 || response.status === 422) {
      throw new RepositoryRevisionConflictError();
    }
    if (!response.ok) {
      throw new Error(`GitHub repository write failed with HTTP ${response.status}.`);
    }
    return this.read(input.path);
  }
}
