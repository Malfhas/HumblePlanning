import { db } from "@/db";
import { users } from "@/db/schema";
import { sessions, verifications } from "@/db/schema/auth";
import { eq, and, gt, isNull, lt, or } from "drizzle-orm";
import { getConfigValues } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { clearCounters, lockedFor, recordFailure, type DbExecutor } from "@/lib/services/security-counter-service";
import { AppError, handleApiError } from "@/lib/utils/api";
import { matchTotpStep, TWO_FACTOR_POLICY, twoFactorFailureKey } from "@/lib/utils/two-factor-guard";

type PendingPayload = { userId: string; sessionId?: string; sessionCookie?: string | null; rememberMe: boolean };
type Rejection = { reason: string; code: string };

function tooManyAttempts(remainingSeconds: number): AppError {
  return new AppError("auth.errors.tooManyAttemptsMinutes", { status: 429, params: { count: Math.ceil(remainingSeconds / 60) } });
}

/** Removes the backup code from the user's list (row locked by the caller); the rejection when it is not there. */
async function consumeBackupCode(tx: DbExecutor, userId: string, stored: string | null, code: string): Promise<Rejection | null> {
  const storedCodes: string[] = JSON.parse(stored || "[]");
  const normalizedCode = code.trim().toUpperCase();
  const idx = storedCodes.findIndex((c: string) => c.toUpperCase() === normalizedCode);
  if (idx === -1) return { reason: "invalid_backup_code", code: "auth.errors.invalidBackupCode" };

  storedCodes.splice(idx, 1);
  await tx.update(users).set({ twoFactorBackupCodes: JSON.stringify(storedCodes) }).where(eq(users.id, userId));
  return null;
}

/** Accepts a TOTP code only if its time step is newer than the last one accepted for the user (conditional update). */
async function consumeTotpCode(tx: DbExecutor, userId: string, secret: string, code: string): Promise<Rejection | null> {
  const step = matchTotpStep(code, secret);
  if (step === null) return { reason: "invalid_totp_code", code: "auth.errors.invalidCode" };

  const [accepted] = await tx.update(users)
    .set({ twoFactorLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.twoFactorLastStep), lt(users.twoFactorLastStep, step))))
    .returning({ id: users.id });
  return accepted ? null : { reason: "totp_replay", code: "auth.errors.codeAlreadyUsed" };
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

  // One transaction locks the pending token, then the user (SELECT … FOR
  // UPDATE): concurrent requests for the same token or the same user run one
  // after the other, so the lock check, the code check, its consumption and
  // the failure count cannot interleave. A token completed by a concurrent
  // request is gone once its lock is released: that duplicate answers like
  // an expired token and is not counted as a failure (only the holder of the
  // token, who passed the password step, can send it).
  const outcome = await db.transaction(async (tx) => {
    const [verification] = await tx.select({ id: verifications.id, value: verifications.value })
      .from(verifications)
      .where(and(
        eq(verifications.identifier, `2fa-pending:${pendingToken}`),
        gt(verifications.expiresAt, new Date()),
      ))
      .for("update");

    if (!verification) {
      throw new AppError("auth.errors.sessionExpired");
    }

    let payload: PendingPayload;
    try {
      payload = JSON.parse(verification.value);
    } catch {
      throw new AppError("auth.errors.invalidToken");
    }

    const [user] = await tx.select({
      twoFactorSecret: users.twoFactorSecret,
      twoFactorBackupCodes: users.twoFactorBackupCodes,
      twoFactorEnabled: users.twoFactorEnabled,
    }).from(users).where(eq(users.id, payload.userId)).for("update");

    // Rate limit: per user, whatever the pending token
    const failureKey = twoFactorFailureKey(payload.userId);
    const lockSeconds = await lockedFor(failureKey, { tx });
    if (lockSeconds > 0) throw tooManyAttempts(lockSeconds);

    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new AppError("auth.errors.twoFactorNotConfigured");
    }

    const rejection = isBackupCode
      ? await consumeBackupCode(tx, payload.userId, user.twoFactorBackupCodes, code)
      : await consumeTotpCode(tx, payload.userId, user.twoFactorSecret, code);
    if (rejection) {
      // Returned, not thrown: the failure is committed with the transaction
      return { payload, rejection, lockSeconds: await recordFailure(failureKey, TWO_FACTOR_POLICY, { tx }) };
    }

    await clearCounters([failureKey], { tx });
    // The pending token is single-use
    await tx.delete(verifications).where(eq(verifications.id, verification.id));
    return { payload, rejection: null, lockSeconds: 0 };
  });

  const { userId, sessionId, sessionCookie, rememberMe } = outcome.payload;

  if (outcome.rejection) {
    logAudit({ userId, action: "2fa_fail", entityType: "user", entityId: userId, metadata: { reason: outcome.rejection.reason } }).catch(() => {});
    throw outcome.lockSeconds > 0 ? tooManyAttempts(outcome.lockSeconds) : new AppError(outcome.rejection.code);
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
