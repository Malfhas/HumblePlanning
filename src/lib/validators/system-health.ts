import { z } from "zod";
import { AppError } from "@/lib/errors";
import { uuidSchema } from "./common";
import { LOG_CATEGORIES, STORED_LEVELS } from "@/lib/system-health/categories";

/** « Last N days » filter of the AI history and System health pages; "all" = no limit. */
const periodSchema = z
  .enum(["1", "7", "30", "90", "all"])
  .default("30")
  .transform((value) => (value === "all" ? null : Number(value)));

/** Comma-separated list in a query parameter. */
const listOf = <T extends z.ZodType<unknown, string>>(item: T, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").filter(Boolean) : []))
    .pipe(z.array(item).max(max));

const pageSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
};

export const aiHistoryFiltersSchema = z.object({
  days: periodSchema,
  userIds: listOf(uuidSchema, 200),
  models: listOf(z.string().min(1).max(200), 50),
});

export const aiHistoryListSchema = aiHistoryFiltersSchema.extend(pageSchema);

export const systemEventsQuerySchema = z.object({
  days: periodSchema,
  levels: listOf(z.enum(STORED_LEVELS), STORED_LEVELS.length),
  categories: listOf(z.enum(LOG_CATEGORIES), LOG_CATEGORIES.length),
  search: z.string().trim().max(200).optional(),
  ...pageSchema,
});

export const deliveriesQuerySchema = z.object({ days: periodSchema });

/** « Before the » date of a manual purge (YYYY-MM-DD). */
export const purgeBeforeSchema = z.object({ before: z.string().date() });

/** Query parameters validated by `schema`; 422 `errors.invalidData` otherwise. */
export function parseQuery<T extends z.ZodType>(schema: T, params: URLSearchParams): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(params));
  if (!result.success) throw new AppError("errors.invalidData", { status: 422, details: result.error.issues });
  return result.data;
}
