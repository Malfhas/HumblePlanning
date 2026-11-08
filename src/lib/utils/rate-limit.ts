// In-memory rate limiting, per process: throughput limit of the key-based
// REST API, checked on every request (a database write per request would cost
// more than it protects: keys are 256-bit random values, a restart only resets
// a one-minute window). Security counters (login and 2FA lockouts, password
// reset cooldowns, OAuth endpoints) are stored in PostgreSQL instead, see
// security-counter-service.ts.

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

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The eight 16-bit groups of an IPv6 address (embedded IPv4 tail allowed), null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (lastColon >= 0 && tail.includes(".")) {
    if (!IPV4.test(tail)) return null;
    const [a, b, c, d] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...head, ...rest].some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((group) => parseInt(group, 16));
}

/**
 * Part of a lock key that stands for a client address. An IPv6 client usually
 * holds a whole /64 and can pick any address in it, so IPv6 addresses count by
 * their /64 prefix; IPv4 addresses, and IPv4-mapped IPv6 ones (`::ffff:a.b.c.d`),
 * as the IPv4 address. Anything else is kept as it is.
 */
export function addressBucket(ip: string): string {
  const address = ip.trim().replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "").toLowerCase();
  if (IPV4.test(address)) return address;
  const groups = ipv6Groups(address);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}
