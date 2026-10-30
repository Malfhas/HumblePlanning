import { db } from "@/db";
import { users } from "@/db/schema";
import { accounts, sessions, verifications } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import { apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { hashPassword } from "@/lib/password";
import { getConfigValues } from "@/lib/services/config-service";
import { policyFromConfig, evaluatePassword, PWD_CONFIG_KEYS } from "@/lib/password-policy";
import { isPasswordReused, isPasswordBlacklisted, addPasswordToHistory } from "@/lib/services/password-history-service";
import { logAudit } from "@/lib/services/audit-service";
import { verifyCaptcha } from "@/lib/captcha";
import { logger } from "@/lib/logger";
import { passwordNotCompliantError, passwordRejectedError } from "@/lib/services/user-service";

/** GET: Validate token and return user username */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) throw new AppError("auth.errors.tokenRequired");

    const [verification] = await db.select().from(verifications).where(eq(verifications.value, token)).limit(1);

    if (!verification) throw new AppError("auth.errors.linkInvalidOrExpired");

    if (new Date() > verification.expiresAt) {
      await db.delete(verifications).where(eq(verifications.id, verification.id));
      throw new AppError("auth.errors.linkExpired");
    }

    const userId = verification.identifier.replace("reset:", "");
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { username: true, name: true },
    });

    if (!user) throw new AppError("users.errors.notFound", { status: 404 });

    return apiSuccess({ username: user.username, name: user.name });
  } catch (err) {
    if (err instanceof AppError) return handleApiError(err);
    logger.error("auth", "reset-password GET error", { error: err instanceof Error ? err.message : String(err) });
    return handleApiError(new AppError("errors.internal", { status: 500 }));
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, password, captchaToken } = body;

    if (!token || typeof token !== "string") {
      throw new AppError("auth.errors.tokenRequired");
    }
    if (!password || typeof password !== "string") {
      throw new AppError("auth.errors.passwordRequired");
    }

    // Verify captcha
    try {
      await verifyCaptcha(captchaToken);
    } catch (err) {
      throw err instanceof AppError ? err : new AppError("auth.errors.captchaFailed");
    }

    // Find the verification entry by token value
    const [verification] = await db.select().from(verifications).where(eq(verifications.value, token)).limit(1);

    if (!verification) {
      throw new AppError("auth.errors.linkInvalidOrExpired");
    }

    // Check expiration
    if (new Date() > verification.expiresAt) {
      // Clean up expired token
      await db.delete(verifications).where(eq(verifications.id, verification.id));
      throw new AppError("auth.errors.linkExpiredRequestNew");
    }

    // Extract userId from identifier (format: "reset:<userId>")
    const userId = verification.identifier.replace("reset:", "");

    // Validate password against policy
    const config = await getConfigValues([...PWD_CONFIG_KEYS]);
    const policy = policyFromConfig(config);
    const strength = evaluatePassword(password, policy);

    if (!strength.valid) throw await passwordNotCompliantError(strength, { status: 400 });

    // Check blacklist
    const blacklisted = await isPasswordBlacklisted(password);
    if (blacklisted) {
      throw passwordRejectedError("users.errors.passwordBlacklisted");
    }

    // Check password history
    const reused = await isPasswordReused(userId, password);
    if (reused) {
      throw passwordRejectedError("users.errors.passwordReused");
    }

    // Hash and update the credential account
    const hashed = await hashPassword(password);
    const [existing] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential"))).limit(1);

    if (existing) {
      await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, existing.id));
    } else {
      await db.insert(accounts).values({
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: hashed,
      });
    }

    // Record in password history
    await addPasswordToHistory(userId, hashed);

    // Reset forcePasswordChange flag
    await db.update(users).set({ forcePasswordChange: false }).where(eq(users.id, userId));

    const resetUser = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { name: true, username: true } });
    await logAudit({ userId, action: "password_change", entityType: "user", entityId: userId, metadata: { method: "reset_token", targetUser: resetUser?.name, targetLogin: resetUser?.username } });

    // Invalidate all sessions (force logout on all devices)
    try {
      const { emitSessionRevoked } = await import("@/lib/socket-events");
      emitSessionRevoked(userId);
    } catch { /* socket server may not be running */ }
    await db.delete(sessions).where(eq(sessions.userId, userId));

    // Delete the used token
    await db.delete(verifications).where(eq(verifications.id, verification.id));

    return apiSuccess({ success: true });
  } catch (err) {
    if (err instanceof AppError) return handleApiError(err);
    logger.error("auth", "reset-password POST error", { error: err instanceof Error ? err.message : String(err) });
    return handleApiError(new AppError("errors.internal", { status: 500 }));
  }
}
