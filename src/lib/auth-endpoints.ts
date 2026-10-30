/**
 * Better Auth endpoints that stay reachable over HTTP (`/api/auth/[...all]`).
 *
 * Sign-in goes through `/api/auth/login` (captcha, lockout, 2FA, inactive
 * accounts, audit), which calls `auth.api.signInUsername` on the server.
 * The other native endpoints (sign-in/*, sign-up/email, update-user,
 * revoke-sessions, is-username-available…) would bypass those checks or the
 * application's own validation, so the catch-all route answers 404 for them.
 * Server-side `auth.api.*` calls are not affected.
 */
const HTTP_ENDPOINTS = new Map<string, readonly string[]>([
  // POST is only used by the deferred session refresh, which is not enabled
  ["/api/auth/get-session", ["GET"]],
  ["/api/auth/sign-out", ["POST"]],
]);

export function isHttpAuthEndpoint(method: string, pathname: string): boolean {
  return HTTP_ENDPOINTS.get(pathname)?.includes(method.toUpperCase()) ?? false;
}
