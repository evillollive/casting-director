import type { RuntimeConfig } from "@/server/config";
import { GitHubRepositoryProvider } from "@/server/repository/github";
import { LocalGitRepositoryProvider } from "@/server/repository/local-git";
import type { RepositoryProvider } from "@/server/repository/provider";

export function repositoryProvider(config: RuntimeConfig): RepositoryProvider {
  if (config.CASTING_REPOSITORY_PROVIDER === "github") {
    return new GitHubRepositoryProvider(
      config.CASTING_GITHUB_API_URL,
      config.CASTING_GITHUB_REPOSITORY,
      config.CASTING_GITHUB_BRANCH,
      config.CASTING_GITHUB_TOKEN,
    );
  }
  return new LocalGitRepositoryProvider(
    config.CASTING_REPOSITORY_ROOT,
    config.CASTING_REPOSITORY_COMMIT === "true",
  );
}
