import { z } from "zod";
import { uuidSchema } from "./common";

export const auditFiltersSchema = z.object({
  entityType: z.string().optional(),
  entityId: uuidSchema.optional(),
  action: z.string().optional(),
  userId: z.string().optional(),
  dateStart: z.string().date().optional(),
  dateEnd: z.string().date().optional(),
  search: z.string().optional(),
  source: z.enum(["all", "web", "mcp", "api"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const auditPurgeSchema = z.object({
  before: z.string().date(),
});

export type AuditFilters = z.infer<typeof auditFiltersSchema>;
export type AuditPurge = z.infer<typeof auditPurgeSchema>;
