import { db } from "@/db";
import { users } from "@/db/schema";
import { verifications } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import { getConfigValues } from "@/lib/services/config-service";
import { passwordResetTemplate } from "@/lib/services/email-templates";
import { sendEmail } from "@/lib/services/email-service";
import { verifyCaptcha } from "@/lib/captcha";
import { logger } from "@/lib/logger";
import { isLocale } from "@/i18n/config";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";
import { AppError, handleApiError } from "@/lib/utils/api";
import { getClientIp } from "@/lib/utils/rate-limit";

const RESET_TOKEN_EXPIRY_MINUTES = 10;

// Rate limiting: 1 request per IP per 10 seconds (anti-enumeration)
const ipCooldowns = new Map<string, number>();
const IP_COOLDOWN_MS = 10_000;

// Rate limiting: 1 reset email per user per 60 seconds
const userCooldowns = new Map<string, number>();
const USER_COOLDOWN_MS = 60_000;

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of ipCooldowns) {
    if (now - ts > IP_COOLDOWN_MS + 10_000) ipCooldowns.delete(key);
  }
  for (const [key, ts] of userCooldowns) {
    if (now - ts > USER_COOLDOWN_MS + 10_000) userCooldowns.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Generic response (`auth.forgotPassword.genericResponse`, request
 * language) — must NEVER reveal whether the login exists, whether the email matches
 * or whether the user has no email.
 */
async function genericResponse(): Promise<Response> {
  const t = await getServerTranslator(await resolveRequestLocale());
  return Response.json({ message: t("auth.forgotPassword.genericResponse") }, { status: 200 });
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request.headers);

    // IP cooldown — prevent rapid enumeration
    const lastIp = ipCooldowns.get(ip);
    if (lastIp && Date.now() - lastIp < IP_COOLDOWN_MS) {
      // Always return the generic success message to prevent timing attacks
      return genericResponse();
    }
    ipCooldowns.set(ip, Date.now());

    // Check feature is enabled
    const config = await getConfigValues([
      "FORGOT_PASSWORD_ENABLED",
      "APP_TITLE",
      "APP_BASE_URL",
    ]);
    if (config.FORGOT_PASSWORD_ENABLED !== "true") {
      return handleApiError(new AppError("auth.errors.forgotPasswordDisabled", { status: 403 }));
    }

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body || typeof body.login !== "string" || typeof body.email !== "string") {
      return handleApiError(new AppError("auth.errors.loginAndEmailRequired"));
    }

    const { login, email, captchaToken } = body as {
      login: string;
      email: string;
      captchaToken?: string;
    };

    // Verify captcha if enabled
    try {
      await verifyCaptcha(captchaToken);
    } catch (err) {
      return handleApiError(err instanceof AppError ? err : new AppError("auth.errors.captchaFailed"));
    }

    // Look up user by login (username column in Drizzle)
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.username, login.trim()),
        eq(users.active, true)
      ),
      columns: { id: true, name: true, email: true, locale: true },
    });

    // Validate: user exists, has email, email matches (case-insensitive)
    const emailMatch =
      user?.email &&
      user.email.toLowerCase().trim() === email.toLowerCase().trim();

    if (!user || !emailMatch) {
      // ALWAYS return generic message — do not reveal whether the login or
      // email is wrong, or whether the user exists at all.
      logger.info("auth", "forgot-password: no match", {
        login: login.trim(),
        ip,
      });
      return genericResponse();
    }

    // User cooldown — prevent spamming the same user
    const lastUser = userCooldowns.get(user.id);
    if (lastUser && Date.now() - lastUser < USER_COOLDOWN_MS) {
      // Still return generic message (don't reveal that we found the user)
      return genericResponse();
    }

    // Generate reset token (same mechanism as admin send-reset)
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000
    );

    // Clean up any existing reset tokens for this user
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, `reset:${user.id}`));

    // Store the token
    await db.insert(verifications).values({
      id: crypto.randomUUID(),
      identifier: `reset:${user.id}`,
      value: token,
      expiresAt,
    });

    // Build reset URL and send email
    const baseUrl = config.APP_BASE_URL || "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Language: the user's last known language, otherwise the request's
    // (it is usually the person themselves making the request).
    const template = passwordResetTemplate(
      user.name,
      resetUrl,
      RESET_TOKEN_EXPIRY_MINUTES,
      config.APP_TITLE ?? "HumblePlanning",
      baseUrl,
      isLocale(user.locale) ? user.locale : await resolveRequestLocale()
    );

    await sendEmail({ to: user.email!, ...template });

    // Record cooldown
    userCooldowns.set(user.id, Date.now());

    logger.info("auth", "forgot-password: reset email sent", {
      userId: user.id,
      ip,
    });

    return genericResponse();
  } catch (err) {
    logger.error("auth", "forgot-password error", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Even on internal errors, return the generic message to prevent
    // information leakage through error differentiation.
    return genericResponse();
  }
}
