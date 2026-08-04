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
