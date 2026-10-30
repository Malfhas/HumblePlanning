import { getConfigValues } from "@/lib/services/config-service";
import { isAltchaConfigured, verifyAltchaPayload } from "@/lib/altcha";
import { AppError } from "@/lib/errors";

/**
 * Verify a captcha token server-side.
 * Returns true if captcha is disabled or verification succeeds.
 * Throws an `AppError` (`auth.errors.captcha*`, 400) if verification fails.
 *
 * Supported providers:
 *   - "altcha"     : self-hosted, PBKDF2/SHA-256 proof-of-work, HMAC secrets
 *                    in .env (ALTCHA_HMAC_SECRET / ALTCHA_HMAC_KEY_SECRET).
 *                    No secretKey in DB; those fields are ignored.
 *   - "turnstile"  : Cloudflare Turnstile, secret in DB (CAPTCHA_SECRET_KEY).
 *   - "recaptcha"  : Google reCAPTCHA v3, secret in DB, score >= 0.3 required.
 */
export async function verifyCaptcha(token: string | null | undefined): Promise<boolean> {
  const config = await getConfigValues([
    "CAPTCHA_ENABLED", "CAPTCHA_PROVIDER", "CAPTCHA_SECRET_KEY",
  ]);

  if (config.CAPTCHA_ENABLED !== "true") return true;

  const provider = config.CAPTCHA_PROVIDER || "altcha";

  // ALTCHA uses no secretKey in DB; HMAC secrets live in .env.
  if (provider === "altcha") {
    if (!isAltchaConfigured()) {
      // Fail-open: we log but don't block auth if the admin selected
      // ALTCHA without the secrets being in .env. Otherwise the app
      // would be unreachable until the config is fixed.
      console.warn("[captcha] Provider=altcha but secrets not configured, skipping verification");
      return true;
    }
    if (!token) {
      throw new AppError("auth.errors.captchaRequired");
    }
    return verifyAltcha(token);
  }

  // Turnstile / reCAPTCHA: need the secretKey in DB.
  const secretKey = config.CAPTCHA_SECRET_KEY;
  if (!secretKey) return true; // Not configured — skip

  if (!token) {
    throw new AppError("auth.errors.captchaRequired");
  }

  if (provider === "turnstile") {
    return verifyTurnstile(token, secretKey);
  }

  if (provider === "recaptcha") {
    return verifyRecaptcha(token, secretKey);
  }

  return true;
}

async function verifyAltcha(payload: string): Promise<boolean> {
  // The payload is a base64-encoded JSON string sent by the widget
  // (`name="altcha"` in the form). `verifyAltchaPayload` checks the
  // HMAC signature, the expiry and uniqueness (anti-replay via the store).
  const ok = await verifyAltchaPayload(payload);
  if (!ok) {
    throw new AppError("auth.errors.captchaVerificationFailed");
  }
  return true;
}

async function verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  const data = await res.json() as { success: boolean; "error-codes"?: string[] };

  if (!data.success) {
    throw new AppError("auth.errors.captchaVerificationFailed");
  }

  return true;
}

async function verifyRecaptcha(token: string, secretKey: string): Promise<boolean> {
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  const data = await res.json() as { success: boolean; score?: number; "error-codes"?: string[] };

  if (!data.success) {
    throw new AppError("auth.errors.captchaVerificationFailed");
  }

  // reCAPTCHA v3 returns a score (0.0 - 1.0). Reject scores below 0.3
  if (data.score !== undefined && data.score < 0.3) {
    throw new AppError("auth.errors.captchaScoreTooLow");
  }

  return true;
}
