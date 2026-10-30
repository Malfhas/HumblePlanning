/**
 * Validates an internal redirect target (`?redirect=` parameter of the
 * authentication pages). Only app-relative paths are
 * accepted: `/mcp-authorize?…` yes, `https://evil.tld`, `//evil.tld` or
 * `/\evil.tld` no (anti open-redirect). Returns `null` if the value is
 * missing or rejected.
 */
export function sanitizeRedirectPath(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Backslash (read as "/" by some browsers) and control characters
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** Reads and validates `?redirect=` from the current URL (client side only). */
export function getRedirectFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeRedirectPath(new URLSearchParams(window.location.search).get("redirect"));
}
