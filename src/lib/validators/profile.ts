import { z } from "zod";
import { colorSchema } from "./common";

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  firstName: z.string().max(100).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  mobile: z.string().max(20).optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  job: z.string().max(100).optional().nullable(),
  color: colorSchema.optional(),
});

export const updatePreferencesSchema = z.object({
  defaultView: z.enum(["users", "projects", "places", "resources", "vehicles"]).optional(),
  columnView: z.enum(["days", "hours"]).optional(),
  defaultHomePage: z.string().max(100).optional(),
  notifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export type UpdateProfile = z.infer<typeof updateProfileSchema>;
export type UpdatePreferences = z.infer<typeof updatePreferencesSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
