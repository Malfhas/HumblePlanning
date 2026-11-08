import { z } from "zod";

export const mobileDeviceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  platform: z.enum(["android"]).optional(),
  appVersion: z.string().trim().min(1).max(30).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
});

export const mobileLoginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  device: mobileDeviceSchema.optional(),
});

export const mobileTwoFactorSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(1),
  isBackupCode: z.boolean().optional(),
  device: mobileDeviceSchema.optional(),
});

export const mobilePairingSchema = z.object({
  code: z.string().regex(/^[0-9a-f]{64}$/i),
  device: mobileDeviceSchema.optional(),
});

export const updateMobileDeviceSchema = mobileDeviceSchema.extend({
  pushToken: z.string().min(1).max(4096).nullable().optional(),
});

export const mobileTaskSyncSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Last `serverTime` received: only the tasks changed since then are returned in full. */
  since: z.iso.datetime({ offset: true }).optional(),
  businessUnitIds: z.string().optional(),
});

export type MobileDevice = z.infer<typeof mobileDeviceSchema>;
export type UpdateMobileDevice = z.infer<typeof updateMobileDeviceSchema>;
