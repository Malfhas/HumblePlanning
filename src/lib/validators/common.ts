import { z } from "zod";

// Lenient regex: accepts any 8-4-4-4-12 UUID (system UUIDs like 00000000-0000-0000-0000-000000000001 fail Zod 4's z.string().uuid())
// No hard-coded message: the error is translated from its Zod code (validation.zod.*).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidSchema = z.string().regex(UUID_RE);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const dateRangeSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
});

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional();

export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
