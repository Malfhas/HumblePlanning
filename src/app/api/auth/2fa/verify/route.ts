import { db } from "@/db";
import { users } from "@/db/schema";
import { sessions, verifications } from "@/db/schema/auth";
import { eq, and, gt } from "drizzle-orm";
import { verifySync } from "otplib";
import { getConfigValues } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { AppError, handleApiError } from "@/lib/utils/api";

// In-memory rate limiting for 2FA attempts
const twoFAAttempts = new Map<string, { count: number; blockedUntil: number | null }>();
const MAX_2FA_ATTEMPTS = 5;
const BLOCK_DURATION = 5 * 60 * 1000;

function check2FARate(token: string): boolean {
  const entry = twoFAAttempts.get(token);
  if (!entry) return true;
  if (entry.blockedUntil && Date.now() < entry.blockedUntil) return false;
  if (entry.blockedUntil && Date.now() >= entry.blockedUntil) {
    twoFAAttempts.delete(token);
    return true;
  }
  return entry.count < MAX_2FA_ATTEMPTS;
}

function record2FAFail(token: string) {
  const entry = twoFAAttempts.get(token) ?? { count: 0, blockedUntil: null };
  entry.count++;
  if (entry.count >= MAX_2FA_ATTEMPTS) {
    entry.blockedUntil = Date.now() + BLOCK_DURATION;
  }
  twoFAAttempts.set(token, entry);
}

export async function POST(request: Request) {
  const { pendingToken, code, isBackupCode } = await request.json();

  if (!pendingToken || !code) {
    return handleApiError(new AppError("auth.errors.missingData"));
  }

  // Rate limit
  if (!check2FARate(pendingToken)) {
    return handleApiError(new AppError("auth.errors.tooManyTwoFactorAttempts", { status: 429 }));
  }

  // Validate the pending token
  const verification = await db.query.verifications.findFirst({
    where: and(
      eq(verifications.identifier, `2fa-pending:${pendingToken}`),
      gt(verifications.expiresAt, new Date()),
    ),
  });

  if (!verification) {
    return handleApiError(new AppError("auth.errors.sessionExpired"));
  }

  let payload: { userId: string; sessionId?: string; sessionCookie?: string | null; rememberMe: boolean };
  try {
    payload = JSON.parse(verification.value);
  } catch {
    return handleApiError(new AppError("auth.errors.invalidToken"));
  }

  const { userId, sessionId, sessionCookie, rememberMe } = payload;

  // Fetch user 2FA data
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { twoFactorSecret: true, twoFactorBackupCodes: true, twoFactorEnabled: true },
  });

  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    return handleApiError(new AppError("auth.errors.twoFactorNotConfigured"));
  }

  // Verify code
  if (isBackupCode) {
    const storedCodes: string[] = JSON.parse(user.twoFactorBackupCodes || "[]");
    const normalizedCode = code.trim().toUpperCase();
    const idx = storedCodes.findIndex((c: string) => c.toUpperCase() === normalizedCode);

    if (idx === -1) {
      record2FAFail(pendingToken);
      logAudit({ userId, action: "2fa_fail", entityType: "user", entityId: userId, metadata: { reason: "invalid_backup_code" } }).catch(() => {});
      return handleApiError(new AppError("auth.errors.invalidBackupCode"));
    }

    storedCodes.splice(idx, 1);
    await db.update(users).set({
      twoFactorBackupCodes: JSON.stringify(storedCodes),
    }).where(eq(users.id, userId));
  } else {
    const result = verifySync({ token: code, secret: user.twoFactorSecret });
    if (!result.valid) {
      record2FAFail(pendingToken);
      logAudit({ userId, action: "2fa_fail", entityType: "user", entityId: userId, metadata: { reason: "invalid_totp_code" } }).catch(() => {});
      return handleApiError(new AppError("auth.errors.invalidCode"));
    }
  }

  // 2FA verified — deliver the session cookie that was held back

  // Apply session duration from config
  if (sessionId) {
    const sessionConfig = await getConfigValues(["SESSION_DURATION_DAYS", "SESSION_REMEMBER_DAYS"]);
    const standardDays = parseInt(sessionConfig.SESSION_DURATION_DAYS || "7") || 7;
    const rememberDays = parseInt(sessionConfig.SESSION_REMEMBER_DAYS || "30") || 30;
    const durationMs = (rememberMe ? rememberDays : standardDays) * 24 * 60 * 60 * 1000;
    await db.update(sessions)
      .set({ expiresAt: new Date(Date.now() + durationMs) })
      .where(eq(sessions.id, sessionId));
  }

  // Delete the pending token (one-time use)
  await db.delete(verifications).where(eq(verifications.id, verification.id));
  twoFAAttempts.delete(pendingToken);

  // Replay the original Set-Cookie from Better Auth
  const headers = new Headers({ "Content-Type": "application/json" });
  if (sessionCookie) {
    headers.set("Set-Cookie", sessionCookie);
  }

  // Get user's preferred home page for redirect
  const fullUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  const prefs = (fullUser?.preferences ?? {}) as Record<string, string>;
  const redirectTo = prefs.defaultHomePage || "/planning";

  return new Response(JSON.stringify({ success: true, redirectTo }), {
    status: 200,
    headers,
  });
}
