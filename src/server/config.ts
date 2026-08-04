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
  return result.data;
}
