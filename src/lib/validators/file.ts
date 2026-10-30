import { z } from "zod";

export const fileFiltersSchema = z.object({
  search: z.string().optional(),
  fileType: z.enum(["image", "pdf", "other"]).optional(),
  dateStart: z.string().date().optional(),
  dateEnd: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const filePurgeSchema = z.object({
  before: z.string().date(),
});

export type FileFilters = z.infer<typeof fileFiltersSchema>;
export type FilePurge = z.infer<typeof filePurgeSchema>;
