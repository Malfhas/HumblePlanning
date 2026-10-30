import { NextRequest } from "next/server";

/**
 * Validates the Origin header for CSRF protection on state-changing requests.
 * Returns true if the request is safe (same-origin or GET/HEAD/OPTIONS).
 *
 * This is a defense-in-depth measure alongside SameSite cookies.
 * For now it is available as a utility; it can be wired into sensitive
 * endpoints incrementally without breaking existing functionality.
 */
export function validateOrigin(request: NextRequest): boolean {
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
