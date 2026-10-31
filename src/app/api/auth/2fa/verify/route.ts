import { db } from "@/db";
import { users } from "@/db/schema";
import { sessions, verifications } from "@/db/schema/auth";
import { eq, and, gt } from "drizzle-orm";
import { verifySync } from "otplib";
import { getConfigValues } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { AppError, handleApiError } from "@/lib/utils/api";
import { createTwoFactorLimiter, TotpReplayGuard } from "@/lib/utils/two-factor-guard";

// In-memory protection (per process): failed codes are counted per user
// across pending tokens (a new token comes with each password login), and a
// TOTP time step is accepted only once per user.
const failures = createTwoFactorLimiter();
const usedSteps = new TotpReplayGuard();

/** Records a failed code; 429 once the user's verification gets locked. */
function failedCode(userId: string, reason: string, code: string): AppError {
  logAudit({ userId, action: "2fa_fail", entityType: "user", entityId: userId, metadata: { reason } }).catch(() => {});
  const lockedFor = failures.recordFailure(userId);
  return lockedFor > 0 ? tooManyAttempts(lockedFor) : new AppError(code);
}

function tooManyAttempts(remainingSeconds: number): AppError {
  return new AppError("auth.errors.tooManyAttemptsMinutes", { status: 429, params: { count: Math.ceil(remainingSeconds / 60) } });
}

/** Time step matched by a TOTP code, or null when the code is invalid (malformed codes included). */
function matchTotpStep(code: string, secret: string): number | null {
  try {
    const result = verifySync({ token: code.trim(), secret });
    return result.valid && "timeStep" in result ? result.timeStep : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    return await verifySecondFactor(request);
  } catch (error) {
    return handleApiError(error);
  }
}

async function verifySecondFactor(request: Request): Promise<Response> {
  const { pendingToken, code, isBackupCode } = await request.json();

  if (typeof pendingToken !== "string" || !pendingToken || typeof code !== "string" || !code) {
    throw new AppError("auth.errors.missingData");
  }

  // Validate the pending token
  const verification = await db.query.verifications.findFirst({
    where: and(
      eq(verifications.identifier, `2fa-pending:${pendingToken}`),
      gt(verifications.expiresAt, new Date()),
    ),
  });

  if (!verification) {
    throw new AppError("auth.errors.sessionExpired");
  }

  let payload: { userId: string; sessionId?: string; sessionCookie?: string | null; rememberMe: boolean };
  try {
    payload = JSON.parse(verification.value);
  } catch {
    throw new AppError("auth.errors.invalidToken");
  }

  const { userId, sessionId, sessionCookie, rememberMe } = payload;

  // Rate limit: per user, whatever the pending token
  const lockedFor = failures.lockedFor(userId);
  if (lockedFor > 0) throw tooManyAttempts(lockedFor);

  // Fetch user 2FA data
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { twoFactorSecret: true, twoFactorBackupCodes: true, twoFactorEnabled: true },
  });

  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    throw new AppError("auth.errors.twoFactorNotConfigured");
  }

  // Verify code
  if (isBackupCode) {
    const storedCodes: string[] = JSON.parse(user.twoFactorBackupCodes || "[]");
    const normalizedCode = code.trim().toUpperCase();
    const idx = storedCodes.findIndex((c: string) => c.toUpperCase() === normalizedCode);

    if (idx === -1) throw failedCode(userId, "invalid_backup_code", "auth.errors.invalidBackupCode");

    storedCodes.splice(idx, 1);
    await db.update(users).set({
      twoFactorBackupCodes: JSON.stringify(storedCodes),
    }).where(eq(users.id, userId));
  } else {
    const step = matchTotpStep(code, user.twoFactorSecret);
    if (step === null) throw failedCode(userId, "invalid_totp_code", "auth.errors.invalidCode");
    // Checked and recorded without await in between: concurrent requests
    // carrying the same code cannot both pass.
    if (usedSteps.isReplay(userId, step)) throw failedCode(userId, "totp_replay", "auth.errors.codeAlreadyUsed");
    usedSteps.markUsed(userId, step);
  }
  failures.clear(userId);

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
