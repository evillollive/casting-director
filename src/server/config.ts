import { z } from "zod";

const runtimeConfigSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL URL.",
    ),
  CASTING_APP_URL: z.string().url(),
  CASTING_AUTH_SECRET: z.string().min(32),
  CASTING_AUTH_ADAPTER: z.enum(["session"]).default("session"),
  CASTING_WORKSPACE_SLUG: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default("casting"),
  CASTING_REPOSITORY_PROVIDER: z.enum(["local", "github"]).default("local"),
  CASTING_REPOSITORY_ROOT: z.string().min(1).default("."),
  CASTING_REPOSITORY_COMMIT: z.enum(["true", "false"]).default("false"),
  CASTING_GITHUB_API_URL: z.string().url().default("https://api.github.com"),
  CASTING_GITHUB_REPOSITORY: z.string().default(""),
  CASTING_GITHUB_BRANCH: z.string().min(1).default("main"),
  CASTING_GITHUB_TOKEN: z.string().default(""),
  CASTING_WEBHOOK_SECRET: z.string().default(""),
  CASTING_SYNC_ACTOR_EMAIL: z.union([z.email(), z.literal("")]).default(""),
  CASTING_MAX_REQUEST_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(262_144),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

const workerConfigSchema = runtimeConfigSchema.extend({
  CASTING_LLM_API_KEY: z.string().default(""),
  CASTING_LLM_API_URL: z.union([z.string().url(), z.literal("")]).default(""),
  CASTING_LLM_MODEL: z.string().default(""),
  CASTING_LLM_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(120),
  CASTING_PYTHON_BIN: z.string().min(1).default("python3"),
  CASTING_WORKER_ID: z.string().min(1).max(200).optional(),
  CASTING_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  CASTING_WORKER_LEASE_SECONDS: z.coerce.number().int().min(15).max(3_600).default(120),
  CASTING_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export class ConfigurationError extends Error {
  readonly fields: Record<string, string[]>;

  constructor(fields: Record<string, string[]>) {
    super("Tier 2 runtime configuration is invalid.");
    this.name = "ConfigurationError";
    this.fields = fields;
  }
}

function operationalConfigurationErrors(
  config: RuntimeConfig,
  environment: Record<string, string | undefined>,
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  if (
    environment.NODE_ENV === "production" &&
    config.CASTING_AUTH_SECRET.startsWith("replace-with-")
  ) {
    fields.CASTING_AUTH_SECRET = [
      "Production requires a generated auth secret, not the example placeholder.",
    ];
  }
  if (
    config.CASTING_WEBHOOK_SECRET &&
    config.CASTING_WEBHOOK_SECRET.length < 32
  ) {
    fields.CASTING_WEBHOOK_SECRET = [
      "CASTING_WEBHOOK_SECRET must be at least 32 characters when configured.",
    ];
  }
  if (
    config.CASTING_REPOSITORY_PROVIDER === "github" &&
    !/^[^/]+\/[^/]+$/.test(config.CASTING_GITHUB_REPOSITORY)
  ) {
    fields.CASTING_GITHUB_REPOSITORY = [
      "GitHub integration requires an owner/repository value.",
    ];
  }
  if (
    config.CASTING_REPOSITORY_PROVIDER === "github" &&
    !config.CASTING_GITHUB_TOKEN
  ) {
    fields.CASTING_GITHUB_TOKEN = [
      "GitHub integration requires a fine-grained repository token.",
    ];
  }
  return fields;
}

export function readRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const result = runtimeConfigSchema.safeParse(environment);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "environment";
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    throw new ConfigurationError(fields);
  }
  const operational = operationalConfigurationErrors(result.data, environment);
  if (Object.keys(operational).length > 0) {
    throw new ConfigurationError(operational);
  }
  return result.data;
}

export function readWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const result = workerConfigSchema.safeParse(environment);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "environment";
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    throw new ConfigurationError(fields);
  }
  const operational = operationalConfigurationErrors(result.data, environment);
  if (Object.keys(operational).length > 0) {
    throw new ConfigurationError(operational);
  }
  return result.data;
}
