import { AppError, handleApiError } from "@/lib/utils/api";

/**
 * Validates the Origin header for CSRF protection on state-changing requests.
 * Returns true if the request is safe (same-origin or GET/HEAD/OPTIONS).
 *
 * Defense in depth alongside SameSite cookies, which do not cover the routes
 * used before sign-in (login, password reset, second factor): see
 * `crossOriginRejection`.
 */
export function validateOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  // Safe methods don't need CSRF checks
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // API calls from server-side (no origin) are trusted
  if (!origin && !referer) return true;

  // Validate origin matches the app
  const appUrl = process.env.APP_BASE_URL || process.env.BETTER_AUTH_URL || "";
  if (!appUrl) return true; // Can't validate without config

  const appHost = new URL(appUrl).host;
  if (origin) {
    try { return new URL(origin).host === appHost; } catch { return false; }
  }
  if (referer) {
    try { return new URL(referer).host === appHost; } catch { return false; }
  }
  return true;
}

/**
 * 403 response for a state-changing request sent by another site, else null.
 * The authentication routes call it first: a page elsewhere must not sign a
 * visitor in (to an account of its choice), reset a password or send e-mails.
 */
export async function crossOriginRejection(request: Request): Promise<Response | null> {
  return validateOrigin(request) ? null : handleApiError(new AppError("errors.invalidOrigin", { status: 403 }));
}
