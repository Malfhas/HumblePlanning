import { z } from "zod";
import { uuidSchema } from "./common";

export const filterConfigSchema = z.object({
  teamIds: z.array(uuidSchema).optional(),
  userIds: z.array(uuidSchema).optional(),
  projectIds: z.array(uuidSchema).optional(),
  statusIds: z.array(uuidSchema).optional(),
  businessUnitIds: z.array(uuidSchema).optional(),
  siteAddressIds: z.array(uuidSchema).optional(),
  resourceIds: z.array(uuidSchema).optional(),
  vehicleIds: z.array(uuidSchema).optional(),
  qualificationIds: z.array(uuidSchema).optional(),
  groupIds: z.array(uuidSchema).optional(),
  search: z.string().optional(),
});

export const createSavedFilterSchema = z.object({
  name: z.string().min(1).max(100),
  module: z.string().min(1).max(50).default("planning"),
  filters: filterConfigSchema,
});

export const updateSavedFilterSchema = createSavedFilterSchema.partial();

export type CreateSavedFilter = z.infer<typeof createSavedFilterSchema>;
export type UpdateSavedFilter = z.infer<typeof updateSavedFilterSchema>;
