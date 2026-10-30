// In-memory rate limiting, per process (like the anti-bruteforce lock
// of /api/auth/login). Shared by the OAuth/MCP endpoints
// and the key-based REST API: each caller uses its own key prefix.

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/** Returns `false` if the key exceeded `max` requests over the window. */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size > 10_000) {
      for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
    }
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= max;
}

/**
 * Headers that carry the client address, set by a trusted proxy. The
 * application runs behind a reverse proxy (Caddy, nginx…) that overwrites
 * `X-Real-IP` with the address of the connection. `CF-Connecting-IP` can be
 * sent by anyone, so it only counts with `TRUSTED_PROXY=cloudflare` (site
 * served through the Cloudflare proxy, origin reachable only through it).
 */
export function clientIpHeaders(): string[] {
  return process.env.TRUSTED_PROXY === "cloudflare" ? ["cf-connecting-ip", "x-real-ip"] : ["x-real-ip"];
}

/** Client address for rate limits, lockouts and audit logs. */
export function getClientIp(headers: Headers): string {
  for (const name of clientIpHeaders()) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  // Only the last X-Forwarded-For entry comes from the nearest proxy: the others are sent by the client
  return headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? "127.0.0.1";
}
