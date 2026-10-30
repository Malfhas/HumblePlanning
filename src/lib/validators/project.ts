import { z } from "zod";
import { colorSchema, uuidSchema } from "./common";

export const createProjectSchema = z.object({
  businessNumber: z.string().max(15).optional().nullable(),
  name: z.string().min(1).max(50),
  color: colorSchema.default("#FFFFFF"),
  status: z.enum(["todo", "in_progress", "done", "archived"]).default("todo"),
  groupId: uuidSchema.optional().nullable(),
  businessUnitId: uuidSchema.optional().nullable(),
  ownerId: uuidSchema,
  deliveryDate: z.string().date().optional().nullable(),
  link: z.string().url().optional().nullable(),
  description: z.string().optional().nullable(),
  iteration: z.string().max(255).optional().nullable(),
  budgetAmount: z.string().optional().nullable(),
  budgetTime: z.string().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  addressLat: z.string().optional().nullable(),
  addressLng: z.string().optional().nullable(),
});

export const updateProjectSchema = z.object({
  businessNumber: z.string().max(15).optional().nullable(),
  name: z.string().min(1).max(50),
  color: colorSchema,
  status: z.enum(["todo", "in_progress", "done", "archived"]),
  groupId: uuidSchema.optional().nullable(),
  businessUnitId: uuidSchema.optional().nullable(),
  ownerId: uuidSchema,
  deliveryDate: z.string().date().optional().nullable(),
  link: z.string().url().optional().nullable(),
  description: z.string().optional().nullable(),
  iteration: z.string().max(255).optional().nullable(),
  budgetAmount: z.string().optional().nullable(),
  budgetTime: z.string().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  addressLat: z.string().optional().nullable(),
  addressLng: z.string().optional().nullable(),
}).partial();

export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
