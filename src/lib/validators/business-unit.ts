import { z } from "zod";

export const createBusinessUnitSchema = z.object({
  name: z.string().min(1).max(150),
  color: z.string().max(7).optional(),
  number: z.string().min(1).max(50),
  address: z.string().min(1).max(500),
  latitude: z.string().min(1),
  longitude: z.string().min(1),
});

export const updateBusinessUnitSchema = createBusinessUnitSchema.partial();

export type CreateBusinessUnit = z.infer<typeof createBusinessUnitSchema>;
export type UpdateBusinessUnit = z.infer<typeof updateBusinessUnitSchema>;
