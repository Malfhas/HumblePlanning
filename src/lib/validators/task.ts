import { z } from "zod";
import { uuidSchema } from "./common";

export const createTaskSchema = z.object({
  projectId: uuidSchema,
  userIds: z.array(uuidSchema).min(1),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  title: z.string().max(255).optional(),
  notes: z.string().optional(),
  link: z.string().url().optional(),
  statusId: uuidSchema,
  placeId: uuidSchema.optional().nullable(),
  placeText: z.string().max(255).optional().nullable(),
  placeTextLat: z.string().optional().nullable(),
  placeTextLng: z.string().optional().nullable(),
  resourceId: uuidSchema.optional().nullable(),
  parentId: uuidSchema.optional().nullable(),
  isMilestone: z.boolean().default(false),
  duration: z.string().optional(),
  durationDetails: z.string().max(20).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  breakDuration: z.string().optional(),
  customField: z.string().max(255).optional(),
  // No `files` here: attachments only go through /api/tasks/[id]/files, which
  // stores server-generated metadata (client metadata reaches the disk on deletion).
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  isLocked: z.boolean().optional(),
});

export const moveTaskSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  userIds: z.array(uuidSchema).optional(),
  projectId: uuidSchema.optional(),
  placeId: uuidSchema.optional(),
  resourceId: uuidSchema.optional(),
});

export const resizeTaskSchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export const copyTaskSchema = z.object({
  startDate: z.string().date(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  userIds: z.array(uuidSchema).optional(),
  projectId: uuidSchema.optional(),
  placeId: uuidSchema.optional(),
  resourceId: uuidSchema.optional(),
});

export const taskFiltersSchema = z.object({
  projectId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  statusId: uuidSchema.optional(),
  placeId: uuidSchema.optional(),
  resourceId: uuidSchema.optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  search: z.string().optional(),
  // Business unit multi-select from the header (useBuStore) or the filter panel.
  // Comma-separated URL param: `?businessUnitIds=uuid1,uuid2`.
  // If missing or empty → no BU filter applied (all BUs visible).
  // Applied in SQL via a subquery on `projects.business_unit_id` to avoid
  // needlessly transferring tasks of unselected BUs.
  businessUnitIds: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
      return ids.length > 0 ? ids : undefined;
    })
    .pipe(z.array(uuidSchema).optional()),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(200),
  // Bypass pagination (limit/offset), used only by /planning, which
  // needs every task in the range. The other callers
  // (/tasks page, exports, etc.) keep normal pagination.
  unpaginated: z.coerce.boolean().optional(),
});

export const taskPurgeSchema = z.object({
  before: z.string().date(),
});

export const recurRuleSchema = z.object({
  recurType: z.enum(["daily", "weekly", "monthly"]),
  recurFrequency: z.number().int().min(1).max(30).default(1),
  recurEndDate: z.string().date(),
  recurDayOfWeek: z.number().int().min(0).max(6).optional(),
  recurException: z.enum(["shift", "skip", "include"]).default("skip"),
});

export const repeatTaskSchema = recurRuleSchema;

export type RecurRule = z.infer<typeof recurRuleSchema>;
export type RepeatTask = z.infer<typeof repeatTaskSchema>;

export type CreateTask = z.infer<typeof createTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
export type MoveTask = z.infer<typeof moveTaskSchema>;
export type ResizeTask = z.infer<typeof resizeTaskSchema>;
export type CopyTask = z.infer<typeof copyTaskSchema>;
export type TaskFilters = z.infer<typeof taskFiltersSchema>;
