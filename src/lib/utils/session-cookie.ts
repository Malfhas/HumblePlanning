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
