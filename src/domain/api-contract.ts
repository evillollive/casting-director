import { z } from "zod";

export const candidateStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "PASSED",
  "CAST",
  "MAYBE_LATER",
]);

export const sourceFamilySchema = z.enum([
  "NEWS",
  "CODE_HOST",
  "COMMUNITY",
  "MAKER",
  "GAMES",
  "VIDEO",
  "SOCIAL",
  "SCIENCE",
  "CIVIC",
  "ACCESSIBILITY",
  "OTHER",
]);

export const paginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const queryBooleanSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const candidateQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  status: candidateStatusSchema.optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  sourceFamily: sourceFamilySchema.optional(),
  region: z.string().trim().min(1).max(120).optional(),
  minimumOverallScore: z.coerce.number().int().min(0).max(5).optional(),
  isEvergreen: queryBooleanSchema.optional(),
  gatePassed: queryBooleanSchema.optional(),
  doNotResurface: queryBooleanSchema.optional(),
  notForSurfacing: queryBooleanSchema.optional(),
  sort: z.enum(["updatedAt", "score", "name"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

const candidatePatchFields = z.object({
  status: candidateStatusSchema.optional(),
  tagIds: z.array(z.string().min(1)).max(50).optional(),
  note: z.string().trim().min(1).max(10_000).optional(),
  doNotResurface: z.boolean().optional(),
  notForSurfacing: z.boolean().optional(),
  parkedReason: z.string().trim().max(2_000).nullable().optional(),
});

export const candidatePatchSchema = candidatePatchFields
  .extend({ version: z.number().int().positive() })
  .refine(
    ({ tagIds }) => !tagIds || new Set(tagIds).size === tagIds.length,
    { path: ["tagIds"], message: "tagIds must not contain duplicates." },
  )
  .refine(
    (patch) =>
      Object.entries(patch).some(
        ([key, value]) => key !== "version" && value !== undefined,
      ),
    { message: "At least one candidate field must be supplied." },
  );

export const candidateBulkPatchSchema = candidatePatchFields
  .omit({ note: true, parkedReason: true })
  .extend({
    candidateIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .refine(
    ({ candidateIds }) => new Set(candidateIds).size === candidateIds.length,
    {
      path: ["candidateIds"],
      message: "candidateIds must not contain duplicates.",
    },
  )
  .refine(
    ({ tagIds }) => !tagIds || new Set(tagIds).size === tagIds.length,
    { path: ["tagIds"], message: "tagIds must not contain duplicates." },
  )
  .refine(
    (patch) =>
      Object.entries(patch).some(
        ([key, value]) => key !== "candidateIds" && value !== undefined,
      ),
    { message: "At least one bulk candidate field must be supplied." },
  );

export const createScanSchema = z.object({
  runDate: z.iso.date(),
  sourceKeys: z.array(z.string().min(1)).min(1).max(100),
}).refine(
  ({ sourceKeys }) => new Set(sourceKeys).size === sourceKeys.length,
  { path: ["sourceKeys"], message: "sourceKeys must not contain duplicates." },
);

export const scanQuerySchema = paginationSchema.extend({
  status: z
    .enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"])
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  summary: z.string().trim().min(1).max(200).optional(),
}).refine(
  ({ from, to }) => !from || !to || from <= to,
  { path: ["to"], message: "to must be on or after from." },
);

export const tuningUpdateSchema = z.object({
  version: z.number().int().positive(),
  beat: z.string().trim().min(1).max(4_000),
  hardNos: z.array(z.string().trim().min(1).max(1_000)).max(100),
  moreOf: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).refine(
  ({ hardNos }) => new Set(hardNos).size === hardNos.length,
  { path: ["hardNos"], message: "hardNos must not contain duplicates." },
).refine(
  ({ moreOf }) => new Set(moreOf).size === moreOf.length,
  { path: ["moreOf"], message: "moreOf must not contain duplicates." },
);

export const tasteLogQuerySchema = paginationSchema;

export const tasteLogCreateSchema = z.object({
  weekOf: z.iso.date(),
  note: z.string().trim().min(1).max(10_000),
});

export const tasteLogPatchSchema = z.object({
  version: z.number().int().positive(),
  note: z.string().trim().min(1).max(10_000),
});

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
