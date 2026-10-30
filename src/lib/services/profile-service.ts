import { db } from "@/db";
import { users } from "@/db/schema";
import { accounts, sessions } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import type { UpdateProfile, UpdatePreferences } from "@/lib/validators/profile";
import { logAudit, computeChanges, pickAuditFields } from "./audit-service";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getConfigValues } from "./config-service";
import { policyFromConfig, evaluatePassword, PWD_CONFIG_KEYS } from "@/lib/password-policy";
import { isPasswordReused, isPasswordBlacklisted, addPasswordToHistory } from "./password-history-service";
import { getUserById, passwordNotCompliantError, passwordRejectedError } from "./user-service";
import { AppError } from "@/lib/errors";
import { assertNotDemoAccount } from "@/lib/demo";

export async function getProfile(userId: string) {
  return getUserById(userId);
}

export async function updateProfile(userId: string, data: UpdateProfile) {
  assertNotDemoAccount(userId);
  const oldUser = await db.query.users.findFirst({ where: eq(users.id, userId) });

  // Email is not editable from the profile — only admin can change it
  const [user] = await db
    .update(users)
    .set({
      name: data.name,
      firstName: data.firstName,
      phone: data.phone,
      mobile: data.mobile,
      address: data.address,
      job: data.job,
      color: data.color,
    })
    .where(eq(users.id, userId))
    .returning();

  if (user && oldUser) {
    const changes = computeChanges(
      oldUser as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
      "user"
    );
    if (changes) {
      await logAudit({
        userId,
        action: "update",
        entityType: "user",
        entityId: userId,
        oldValues: changes.old,
        newValues: changes.new,
        changeCount: changes.count,
      });
    }
  }

  return user;
}

export async function changeProfilePassword(userId: string, currentPassword: string, newPassword: string) {
  assertNotDemoAccount(userId);

  // Verify current password
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")),
    columns: { id: true, password: true },
  });
  if (!account?.password) {
    throw new AppError("profile.errors.noPassword", { fields: { currentPassword: { code: "profile.errors.noPassword" } } });
  }

  // Wrong current password: 401 (code profile.errors.wrongPassword), without
  // redirect to /login (only errors.unauthenticated triggers it).
  const valid = await verifyPassword({ password: currentPassword, hash: account.password });
  if (!valid) {
    throw new AppError("profile.errors.wrongPassword", { fields: { currentPassword: { code: "profile.errors.wrongPassword" } } });
  }

  // Validate against policy
  const config = await getConfigValues([...PWD_CONFIG_KEYS]);
  const policy = policyFromConfig(config);
  const strength = evaluatePassword(newPassword, policy);
  if (!strength.valid) throw await passwordNotCompliantError(strength, { field: "newPassword" });

  // Check blacklist
  const blacklisted = await isPasswordBlacklisted(newPassword);
  if (blacklisted) throw passwordRejectedError("users.errors.passwordBlacklisted", { field: "newPassword" });

  // Check password history
  const reused = await isPasswordReused(userId, newPassword);
  if (reused) throw passwordRejectedError("users.errors.passwordReused", { field: "newPassword", status: 409 });

  // Hash and update
  const hashed = await hashPassword(newPassword);
  await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, account.id));
  await addPasswordToHistory(userId, hashed);

  // Reset forcePasswordChange
  await db.update(users).set({ forcePasswordChange: false }).where(eq(users.id, userId));

  const selfUser = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { name: true, username: true } });
  await logAudit({
    userId,
    action: "password_change",
    entityType: "user",
    entityId: userId,
    metadata: { method: "self_change", targetUser: selfUser?.name, targetLogin: selfUser?.username },
  });

  return { success: true };
}

export async function uploadAvatar(userId: string, buffer: Buffer, filename: string) {
  assertNotDemoAccount(userId);
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const sharp = (await import("sharp")).default;

  const uploadDir = join(process.cwd(), "uploads", "avatars");
  await mkdir(uploadDir, { recursive: true });

  const baseName = `${userId}`;

  // Generate AVIF and WebP
  const avifBuffer = await sharp(buffer)
    .resize(256, 256, { fit: "cover" })
    .avif({ quality: 80 })
    .toBuffer();
  await writeFile(join(uploadDir, `${baseName}.avif`), avifBuffer);

  const webpBuffer = await sharp(buffer)
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();
  await writeFile(join(uploadDir, `${baseName}.webp`), webpBuffer);

  const imagePath = `avatars/${baseName}.avif`;
  await db.update(users).set({ image: imagePath }).where(eq(users.id, userId));

  return imagePath;
}

export async function deleteAvatar(userId: string) {
  assertNotDemoAccount(userId);
  const { unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const uploadDir = join(process.cwd(), "uploads", "avatars");
  const baseName = `${userId}`;

  // Delete files silently
  await unlink(join(uploadDir, `${baseName}.avif`)).catch(() => {});
  await unlink(join(uploadDir, `${baseName}.webp`)).catch(() => {});

  await db.update(users).set({ image: null }).where(eq(users.id, userId));
}

export async function getUserSessions(userId: string) {
  const result = await db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    columns: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
  });
  return result;
}

export async function revokeSession(userId: string, sessionId: string) {
  // The demo account is shared: revoking would sign other visitors out
  assertNotDemoAccount(userId);
  // Verify session belongs to user
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
    columns: { id: true },
  });
  if (!session) throw new AppError("profile.errors.sessionNotFound", { status: 404 });

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  return { success: true };
}

export async function updatePreferences(userId: string, prefs: UpdatePreferences) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true, notifications: true, pushNotifications: true },
  });

  const currentPrefs = (user?.preferences ?? {}) as Record<string, unknown>;
  const merged = { ...currentPrefs };

  if (prefs.defaultView !== undefined) merged.defaultView = prefs.defaultView;
  if (prefs.columnView !== undefined) merged.columnView = prefs.columnView;
  if (prefs.defaultHomePage !== undefined) merged.defaultHomePage = prefs.defaultHomePage;
  if (prefs.theme !== undefined) merged.theme = prefs.theme;

  const updateData: Record<string, unknown> = { preferences: merged };
  // Update user-level preferences (admin master toggles stay untouched)
  if (prefs.notifications !== undefined) {
    updateData.notificationsUser = prefs.notifications;
  }
  if (prefs.pushNotifications !== undefined) {
    updateData.pushNotificationsUser = prefs.pushNotifications;
  }
  if ((prefs as any).smsNotifications !== undefined) {
    updateData.smsNotificationsUser = (prefs as any).smsNotifications;
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  return merged;
}
