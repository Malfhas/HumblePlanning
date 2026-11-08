// Session cookie of Better Auth, seen from the mobile API: the app receives its
// name and raw value in JSON, stores them, and sends them back in a `Cookie`
// header, so that REST routes and Socket.io authenticate it like a browser.

export interface SessionCookie {
  name: string;
  /** Raw value as sent in `Set-Cookie` (URL-encoded `<token>.<signature>`). */
  value: string;
}

const SESSION_COOKIE_RE = /(?:^|[,;]\s*)((?:__Secure-)?better-auth\.session_token)=([^;,\s]*)/;

/**
 * Session cookie found in `Set-Cookie` headers, whatever the prefix. Accepts
 * several headers joined by commas. An empty value (deleted cookie) is ignored.
 */
export function parseSessionSetCookie(setCookies: readonly string[]): SessionCookie | null {
  for (const header of setCookies) {
    const match = SESSION_COOKIE_RE.exec(header);
    if (match?.[2]) return { name: match[1], value: match[2] };
  }
  return null;
}

/** Session token (`session.token` column) carried by a cookie value. */
export function tokenFromCookieValue(value: string): string {
  return decodeURIComponent(value).split(".")[0];
}

const SESSION_SET_COOKIE_RE = /^\s*(?:__Secure-)?better-auth\.session_token=/;

/** Whether a `Set-Cookie` header sets the session cookie (with or without the `__Secure-` prefix). */
export function isSessionSetCookie(header: string): boolean {
  return SESSION_SET_COOKIE_RE.test(header);
}

/**
 * The same `Set-Cookie` header with a lifetime of `seconds` (Max-Age and
 * Expires). Better Auth gives the browser cookie its own `expiresIn` (7 days):
 * the "remember me" duration given to the session row must reach the cookie too.
 */
export function withCookieLifetime(header: string, seconds: number, now: number = Date.now()): string {
  const base = header.replace(/;\s*(?:max-age|expires)=[^;]*/gi, "");
  return `${base}; Max-Age=${seconds}; Expires=${new Date(now + seconds * 1000).toUTCString()}`; // i18n-ignore cookie attributes
}

/** A copy of `source` whose session cookie lasts `seconds`; the other cookies are left as they are. */
export function withSessionCookieLifetime(source: Headers, seconds: number): Headers {
  const headers = new Headers(source);
  const cookies = source.getSetCookie();
  headers.delete("set-cookie");
  for (const cookie of cookies) headers.append("set-cookie", isSessionSetCookie(cookie) ? withCookieLifetime(cookie, seconds) : cookie);
  return headers;
}
