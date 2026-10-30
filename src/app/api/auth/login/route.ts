import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sessions, verifications } from "@/db/schema/auth";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";
import { getConfigValues } from "@/lib/services/config-service";
import { verifyCaptcha } from "@/lib/captcha";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { AppError, handleApiError } from "@/lib/utils/api";
import { getClientIp } from "@/lib/utils/rate-limit";
import crypto from "node:crypto";

// Rate limiting is in-memory (per-process). This works for single-instance deployments.
// For multi-instance/cluster deployments, migrate to Redis-backed rate limiting.
type AttemptEntry = { count: number; lockedUntil: number | null };
const attempts = new Map<string, AttemptEntry>();

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.lockedUntil && now > entry.lockedUntil + 60_000) {
      attempts.delete(key);
    }
  }
}, 10 * 60 * 1000);

function getAttemptKey(identifier: string, ip: string): string {
  return `${identifier.toLowerCase()}:${ip}`;
}

async function checkBruteforce(identifier: string, ip: string): Promise<{ blocked: boolean; remainingSeconds: number }> {
  const config = await getConfigValues(["BRUTEFORCE_MAX_ATTEMPTS", "BRUTEFORCE_LOCKOUT_SECONDS"]);
  const maxAttempts = parseInt(config.BRUTEFORCE_MAX_ATTEMPTS ?? "5") || 0;
  const lockoutSeconds = parseInt(config.BRUTEFORCE_LOCKOUT_SECONDS ?? "300") || 300;

  if (maxAttempts <= 0) return { blocked: false, remainingSeconds: 0 };

  const key = getAttemptKey(identifier, ip);
  const entry = attempts.get(key);

  if (!entry) return { blocked: false, remainingSeconds: 0 };

  if (entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    if (remaining > 0) return { blocked: true, remainingSeconds: remaining };
    attempts.delete(key);
    return { blocked: false, remainingSeconds: 0 };
  }

  return { blocked: false, remainingSeconds: 0 };
}

async function recordFailedAttempt(identifier: string, ip: string): Promise<{ locked: boolean; remainingSeconds: number }> {
  const config = await getConfigValues(["BRUTEFORCE_MAX_ATTEMPTS", "BRUTEFORCE_LOCKOUT_SECONDS"]);
  const maxAttempts = parseInt(config.BRUTEFORCE_MAX_ATTEMPTS ?? "5") || 0;
  const lockoutSeconds = parseInt(config.BRUTEFORCE_LOCKOUT_SECONDS ?? "300") || 300;

  if (maxAttempts <= 0) return { locked: false, remainingSeconds: 0 };

  const key = getAttemptKey(identifier, ip);
  const entry = attempts.get(key) ?? { count: 0, lockedUntil: null };
  entry.count++;

  if (entry.count >= maxAttempts) {
    entry.lockedUntil = Date.now() + lockoutSeconds * 1000;
    attempts.set(key, entry);
    return { locked: true, remainingSeconds: lockoutSeconds };
  }

  attempts.set(key, entry);
  return { locked: false, remainingSeconds: 0 };
}

function clearAttempts(identifier: string, ip: string) {
  attempts.delete(getAttemptKey(identifier, ip));
}

/** 429 "too many attempts": remaining delay in minutes beyond one minute, otherwise in seconds. */
function tooManyAttempts(remainingSeconds: number): AppError {
  return remainingSeconds > 60
    ? new AppError("auth.errors.tooManyAttemptsMinutes", { status: 429, params: { count: Math.ceil(remainingSeconds / 60) } })
    : new AppError("auth.errors.tooManyAttemptsSeconds", { status: 429, params: { count: remainingSeconds } });
}

/**
 * Extract Set-Cookie header value for better-auth.session_token from a Response.
 */
function extractSessionCookie(response: Response): string | null {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookie) {
    if (cookie.startsWith("better-auth.session_token=")) {
      return cookie;
    }
  }
  // Fallback: check raw set-cookie header
  const raw = response.headers.get("set-cookie");
  if (raw?.includes("better-auth.session_token=")) {
    // May contain multiple cookies joined by ", " — find the right one
    const parts = raw.split(/,(?=\s*better-auth\.)/);
    for (const p of parts) {
      if (p.trim().startsWith("better-auth.session_token=")) return p.trim();
    }
    return raw;
  }
  return null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { identifier, password, captchaToken, rememberMe } = body;
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || "unknown";

  if (!identifier || !password) {
    return handleApiError(new AppError("auth.errors.credentialsRequired"));
  }

  // Verify captcha
  try {
    await verifyCaptcha(captchaToken);
  } catch (err) {
    return handleApiError(err instanceof AppError ? err : new AppError("auth.errors.captchaFailed"));
  }

  // Check bruteforce lockout
  const bruteCheck = await checkBruteforce(identifier, ip);
  if (bruteCheck.blocked) {
    return handleApiError(tooManyAttempts(bruteCheck.remainingSeconds));
  }

  try {
    // Sign in with username via Better Auth username plugin.
    //
    // IMPORTANT: we forward `request.headers` to Better Auth so that its
    // internal hooks can extract the client address (see `clientIpHeaders`) and
    // `user-agent` and persist them in the `ip_address` and
    // `user_agent` columns of the `session` table. Without this, Better Auth
    // has no access to the original Request and these columns stay empty
    // (see the active sessions list on /profile → "Inconnu — Inconnu").
    const response = await auth.api.signInUsername({
      body: { username: identifier, password },
      headers: request.headers,
      asResponse: true,
    });

    if (!response.ok) {
      const result = await recordFailedAttempt(identifier, ip);
      logAudit({ action: "login_fail", entityType: "user", metadata: { identifier, ip, userAgent } }).catch(() => {});
      if (result.locked) {
        logAudit({ action: "bruteforce_lock", entityType: "user", metadata: { identifier, ip, lockoutSeconds: result.remainingSeconds } }).catch(() => {});
        return handleApiError(tooManyAttempts(result.remainingSeconds));
      }
      return handleApiError(new AppError("auth.errors.invalidCredentials"));
    }

    // Success — clear attempts
    clearAttempts(identifier, ip);

    // Extract user and session info
    const cloned = response.clone();
    const result = await cloned.json().catch(() => null) as { user?: { id?: string }; session?: { id?: string; token?: string } } | null;

    if (result?.user?.id) {
      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, result.user.id),
        columns: {
          active: true,
          forcePasswordChange: true,
          twoFactorEnabled: true,
          forceTwoFactor: true,
        },
      });

      // Block inactive accounts — delete the session Better Auth just created
      if (!dbUser || dbUser.active === false) {
        if (result.session?.id) {
          await db.delete(sessions).where(eq(sessions.id, result.session.id));
        }
        logAudit({ action: "login_fail", entityType: "user", metadata: { identifier, ip, userAgent, reason: "account_inactive" } }).catch(() => {});
        return handleApiError(new AppError("auth.errors.accountDisabled", { status: 403 }));
      }

      logAudit({
        userId: result.user.id,
        action: "login",
        entityType: "user",
        entityId: result.user.id,
        metadata: { identifier, ip, userAgent },
      }).catch(() => {});

      // users.locale = effective language of this login (emails, notifications).
      const loggedUserId = result.user.id;
      resolveRequestLocale()
        .then((locale) => db.update(users).set({ lastLoginAt: new Date(), locale }).where(eq(users.id, loggedUserId)))
        .catch(() => {});

      // ─── 2FA REQUIRED ───
      // SECURITY: Do NOT send the session cookie — store it server-side
      // and only deliver it after successful TOTP verification.
      if (dbUser?.twoFactorEnabled) {
        // Extract the signed session cookie from Better Auth's response
        const sessionCookie = extractSessionCookie(response);

        // Create a pending token that holds the cookie value server-side
        const pendingToken = crypto.randomUUID();
        await db.insert(verifications).values({
          id: crypto.randomUUID(),
          identifier: `2fa-pending:${pendingToken}`,
          value: JSON.stringify({
            userId: result.user.id,
            sessionId: result.session?.id,
            sessionCookie, // The full Set-Cookie header to replay after 2FA
            rememberMe: !!rememberMe,
          }),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
        });

        // Return WITHOUT Set-Cookie — the browser gets NO session
        return Response.json({ twoFactorRequired: true, pendingToken });
      }

      // ─── 2FA SETUP REQUIRED ───
      const config = await getConfigValues(["TWOFACTOR_REQUIRED"]);
      const globalRequired = config.TWOFACTOR_REQUIRED === "true";
      if ((globalRequired || dbUser?.forceTwoFactor) && !dbUser?.twoFactorEnabled) {
        const newBody = { ...result, setupTwoFactorRequired: true };
        return new Response(JSON.stringify(newBody), {
          status: response.status,
          headers: response.headers,
        });
      }

      // ─── SESSION DURATION ───
      if (result.session?.id) {
        const sessionConfig = await getConfigValues(["SESSION_DURATION_DAYS", "SESSION_REMEMBER_DAYS"]);
        const standardDays = parseInt(sessionConfig.SESSION_DURATION_DAYS || "7") || 7;
        const rememberDays = parseInt(sessionConfig.SESSION_REMEMBER_DAYS || "30") || 30;
        const durationMs = (rememberMe ? rememberDays : standardDays) * 24 * 60 * 60 * 1000;
        await db.update(sessions)
          .set({ expiresAt: new Date(Date.now() + durationMs) })
          .where(eq(sessions.id, result.session.id));
      }

      // ─── FORCE PASSWORD CHANGE ───
      if (dbUser?.forcePasswordChange) {
        const newBody = { ...result, forcePasswordChange: true };
        return new Response(JSON.stringify(newBody), {
          status: response.status,
          headers: response.headers,
        });
      }

      // ─── REDIRECT TO USER'S DEFAULT HOME PAGE ───
      // Respect user preference, but fall back intelligently if they no longer
      // have permission for the chosen page.
      const fullUser = await db.query.users.findFirst({
        where: eq(users.id, result.user.id),
        columns: { preferences: true },
      });
      const prefs = (fullUser?.preferences ?? {}) as Record<string, string>;
      const preferred = prefs.defaultHomePage || "/planning";

      // Check permissions to validate the preferred redirect
      const { loadUserPermissions, hasPermission } = await import("@/lib/services/permission-service");
      const userPerms = await loadUserPermissions(result.user.id);

      const PAGE_PERM_MAP: Record<string, string> = {
        "/planning": "pages:planning",
        "/home": "pages:home",
        "/tasks": "pages:tasks",
      };
      const preferredPerm = PAGE_PERM_MAP[preferred];
      let redirectTo = preferred;
      if (preferredPerm && !hasPermission(userPerms, preferredPerm)) {
        // Preferred page not allowed — try /home, then /planning, then /tasks
        if (hasPermission(userPerms, "pages:home")) redirectTo = "/home";
        else if (hasPermission(userPerms, "pages:planning")) redirectTo = "/planning";
        else if (hasPermission(userPerms, "pages:tasks")) redirectTo = "/tasks";
        else redirectTo = "/home"; // ultimate fallback
      }

      const newBody = { ...result, redirectTo };
      return new Response(JSON.stringify(newBody), {
        status: response.status,
        headers: response.headers,
      });
    }

    return response;
  } catch {
    await recordFailedAttempt(identifier, ip);
    logAudit({
      action: "login_fail",
      entityType: "user",
      metadata: { identifier, ip, userAgent },
    }).catch(() => {});

    return handleApiError(new AppError("auth.errors.invalidCredentials"));
  }
}
