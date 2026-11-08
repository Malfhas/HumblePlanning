// Push relay of the published mobile app: lets self-hosted Humble Planning
// servers wake the app up without holding the Firebase key of its project. It
// receives `{ fid, alertId }` (`fid`: the Firebase Installation ID the app
// registered) and forwards a data message with the alert id only; it stores
// nothing and never sees planning data.
//
// Environment: FCM_SERVICE_ACCOUNT_JSON (required), PORT (default 8080),
// RELAY_KEY (optional: required as `Authorization: Bearer` when set),
// TRUSTED_PROXY=cloudflare (only behind the Cloudflare proxy: the per-address
// limit then reads CF-Connecting-IP, which any direct client could forge).
import { createHash, createSign, timingSafeEqual } from "node:crypto";

const OAUTH_URL = process.env.FCM_OAUTH_URL || "https://oauth2.googleapis.com/token";
const FCM_BASE_URL = process.env.FCM_BASE_URL || "https://fcm.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const RELAY_KEY = process.env.RELAY_KEY?.trim() || null;
const BEHIND_CLOUDFLARE = process.env.TRUSTED_PROXY?.trim() === "cloudflare";

const MAX_PER_IP_PER_MINUTE = 600;
const MAX_PER_DEVICE_PER_MINUTE = 30;
const MAX_BODY_BYTES = 8192;
/** Calls to Google give up after this delay. */
const REQUEST_TIMEOUT_MS = 10_000;

const account = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON ?? "null") as {
  project_id: string;
  client_email: string;
  private_key: string;
} | null;
if (!account?.project_id || !account.client_email || !account.private_key) {
  console.error("FCM_SERVICE_ACCOUNT_JSON must hold a Firebase service account");
  process.exit(1);
}

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (accessToken && accessToken.expiresAt > now + 60_000) return accessToken.value;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(now / 1000);
  const unsigned = [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({ iss: account!.client_email, scope: SCOPE, aud: OAUTH_URL, iat: seconds, exp: seconds + 3600 }),
  ].join(".");
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account!.private_key, "base64url");
  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OAuth token refused: HTTP ${response.status}`);
  const { access_token: value, expires_in: expiresIn } = await response.json() as { access_token: string; expires_in: number };
  accessToken = { value, expiresAt: now + expiresIn * 1000 };
  return value;
}

const counters = new Map<string, { count: number; resetAt: number }>();

function allowed(key: string, max: number): boolean {
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || entry.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of counters) if (entry.resetAt <= now) counters.delete(key);
}, 60_000).unref();

const json = (status: number, body: object) => Response.json(body, { status });

const digest = (value: string) => createHash("sha256").update(value).digest();
const RELAY_KEY_DIGEST = RELAY_KEY ? digest(`Bearer ${RELAY_KEY}`) : null;

/** The server's key, compared in constant time (digests of equal length). */
function authorized(header: string | null): boolean {
  return RELAY_KEY_DIGEST === null || timingSafeEqual(digest(header ?? ""), RELAY_KEY_DIGEST);
}

/** Firebase no longer knows the installation: HTTP v1 error detail `errorCode: "UNREGISTERED"`. */
function isUnregistered(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return Array.isArray(details) && details.some((detail) => (detail as { errorCode?: unknown } | null)?.errorCode === "UNREGISTERED");
}

const server = Bun.serve({
  port: parseInt(process.env.PORT || "8080", 10),
  // Bun refuses a larger body itself, also when it comes without Content-Length
  maxRequestBodySize: MAX_BODY_BYTES,
  async fetch(request, bunServer) {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") return json(200, { status: "ok" });
    if (request.method !== "POST" || pathname !== "/v1/push") return json(404, { error: "not_found" });

    if (!authorized(request.headers.get("authorization"))) return json(401, { error: "unauthorized" });
    const forwarded = BEHIND_CLOUDFLARE ? request.headers.get("cf-connecting-ip") : null;
    const ip = forwarded ?? bunServer.requestIP(request)?.address ?? "unknown";
    if (!allowed(`ip:${ip}`, MAX_PER_IP_PER_MINUTE)) return json(429, { error: "rate_limited" });

    // Checked before reading anything
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return json(413, { error: "too_large" });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(413, { error: "too_large" });
    let body: { fid?: unknown; alertId?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const { fid, alertId } = body;
    if (typeof fid !== "string" || !fid || fid.length > 4096 || typeof alertId !== "string" || !/^[0-9a-f-]{36}$/i.test(alertId)) {
      return json(400, { error: "invalid_body" });
    }
    if (!allowed(`fid:${fid}`, MAX_PER_DEVICE_PER_MINUTE)) return json(429, { error: "rate_limited" });

    try {
      const response = await fetch(`${FCM_BASE_URL}/v1/projects/${account!.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { fid, android: { priority: "HIGH", ttl: "86400s" }, data: { alertId } } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return json(200, { status: "sent" });
      // UNREGISTERED: the server forgets this device. Its own signal, so that no
      // other answer (a 404 of a wrong address, a proxy) ever clears a device
      if (isUnregistered(await response.json().catch(() => null))) return json(410, { error: "unregistered" });
      return json(502, { error: "firebase_refused", status: response.status });
    } catch (error) {
      console.error("Push failed:", error);
      return json(502, { error: "firebase_unreachable" });
    }
  },
});

console.log(`Push relay listening on port ${server.port}`);
