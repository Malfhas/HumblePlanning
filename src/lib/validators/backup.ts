import { z } from "zod";

export const backupListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type BackupListParams = z.infer<typeof backupListSchema>;
