import { z } from "zod";
import { colorSchema, uuidSchema } from "./common";
import { CONTRACT_TYPES } from "@/lib/constants/contract-types";

const contractTypeValues = CONTRACT_TYPES.map((c) => c.value) as [string, ...string[]];

// Fields without defaults: the update schema is built from them, so that a
// partial PUT does not reset the omitted fields (active, forceTwoFactor…).
const userFields = z.object({
  name: z.string().min(1).max(100),
  firstName: z.string().max(100).optional().nullable(),
  username: z.string().min(1).max(100),
  email: z.string().email().optional().nullable(),
  teamId: uuidSchema.optional().nullable(),
  roleId: uuidSchema,
  color: colorSchema,
  visibleOnPlanning: z.boolean(),
  notifications: z.boolean(),
  pushNotifications: z.boolean(),
  smsNotifications: z.boolean(),
  address: z.string().max(255).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  mobile: z.string().max(20).optional().nullable(),
  job: z.string().max(100).optional().nullable(),
  comment: z.string().optional().nullable(),
  contractType: z.enum(contractTypeValues).optional().nullable(),
  active: z.boolean(),
  defaultHourlyRate: z.string().optional().nullable(),
  password: z.string().min(1).optional(),
  forcePasswordChange: z.boolean().optional(),
  generateRandomPassword: z.boolean().optional(),
  forceTwoFactor: z.boolean().optional(),
  qualificationIds: z.array(uuidSchema).optional(),
  businessUnitId: uuidSchema.optional().nullable(),
  laborTypeId: uuidSchema.optional().nullable(),
});

export const createUserSchema = userFields.extend({
  color: colorSchema.default("#FFFFFF"),
  visibleOnPlanning: z.boolean().default(true),
  notifications: z.boolean().default(false),
  pushNotifications: z.boolean().default(false),
  smsNotifications: z.boolean().default(false),
  active: z.boolean().default(true),
  forcePasswordChange: z.boolean().default(false).optional(),
  forceTwoFactor: z.boolean().default(false).optional(),
});

export const updateUserSchema = userFields.partial();

export const sendPasswordResetSchema = z.object({
  userId: uuidSchema,
});

export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
