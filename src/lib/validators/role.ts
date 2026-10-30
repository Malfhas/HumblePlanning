import { z } from "zod";
import { colorSchema } from "./common";

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  color: colorSchema.default("#6b7280"),
  permissions: z.array(z.string().max(100)).default([]),
});

export const updateRoleSchema = createRoleSchema.partial();

export type CreateRole = z.infer<typeof createRoleSchema>;
export type UpdateRole = z.infer<typeof updateRoleSchema>;
