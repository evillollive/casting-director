import { z } from "zod";

const sourceEventSchema = z.object({
  type: z.literal("source"),
  source_key: z.string().min(1),
  status: z.enum(["running", "completed", "failed"]),
  fetched_count: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
});

const progressEventSchema = z
  .object({
    type: z.literal("progress"),
    candidates_fetched: z.number().int().nonnegative().optional(),
    candidates_deduped: z.number().int().nonnegative().optional(),
    candidates_screened: z.number().int().nonnegative().optional(),
    candidates_to_screen: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) =>
      value.candidates_fetched !== undefined ||
      value.candidates_deduped !== undefined ||
      value.candidates_screened !== undefined,
    "A progress event must contain at least one count.",
  );

const promptEventSchema = z.object({
  type: z.literal("prompt"),
  prompt: z.string().min(1),
  prompt_hash: z.string().length(64),
});

const rawCandidateSchema = z.object({
  name: z.string(),
  handle: z.string(),
  project: z.string(),
  project_url: z.string(),
  source: z.string(),
  source_family: z.string(),
  source_url: z.string(),
  fingerprint: z.string().min(1),
  context: z.string(),
});

const candidateSchema = z.object({
  candidate: rawCandidateSchema,
  name: z.string().min(1),
  handle: z.string(),
  project: z.string().min(1),
  hook: z.string().min(1),
  why_now: z.string().min(1),
  voice: z.string().min(1),
  arc: z.string().min(1),
  reach: z.string().min(1),
  caveat: z.string(),
  sensitivity: z.string(),
  overall: z.number().int().min(1).max(5),
  protagonist: z.number().int().min(1).max(5),
  visible_hook: z.number().int().min(1).max(5),
  why_now_score: z.number().int().min(1).max(5),
  voice_score: z.number().int().min(1).max(5),
  arc_score: z.number().int().min(1).max(5),
  reach_score: z.number().int().min(1).max(5),
  rationale: z.string().min(1),
  is_evergreen: z.boolean(),
  category: z.string().min(1),
  region: z.string().min(1),
  not_for_surfacing: z.boolean(),
  parked_reason: z.string(),
  gate_passed: z.boolean(),
  placement: z.enum(["SHORTLIST", "PARKING_LOT", "HARD_EXCLUDED"]),
  rank: z.number().int().positive().nullable(),
});

const violationSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["ERROR", "WARNING"]),
  message: z.string().min(1),
  candidate_reference: z.string().nullable().optional(),
});

const resultEventSchema = z.object({
  type: z.literal("result"),
  status: z.enum(["completed", "failed"]),
  error: z.string().nullable(),
  eval_passed: z.boolean(),
  report_markdown: z.string(),
  violations: z.array(violationSchema),
  candidates: z.array(candidateSchema),
  source_messages: z.array(z.string()),
  counts: z.object({
    candidates_fetched: z.number().int().nonnegative(),
    candidates_deduped: z.number().int().nonnegative(),
    candidates_screened: z.number().int().nonnegative(),
    shortlist_count: z.number().int().nonnegative(),
    parking_count: z.number().int().nonnegative(),
  }),
});

const fatalEventSchema = z.object({
  type: z.literal("fatal"),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const workerEventSchema = z.discriminatedUnion("type", [
  sourceEventSchema,
  progressEventSchema,
  promptEventSchema,
  resultEventSchema,
  fatalEventSchema,
]);

export type WorkerEvent = z.infer<typeof workerEventSchema>;
export type WorkerResultEvent = z.infer<typeof resultEventSchema>;
