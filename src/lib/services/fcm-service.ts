// Real-time push to the mobile app through Firebase Cloud Messaging (HTTP v1).
// A push only wakes the app up: it carries the alert id, and the app then reads
// the alert from this server, so no planning data goes through Google or a relay.
//
// A device is addressed by its Firebase Installation ID (FID), which the app
// registers with `FirebaseMessaging.register()` and sends as its `pushToken`
// (FCM registration tokens are deprecated since firebase-messaging 25.1).
// Firebase ties a FID to the Firebase project of the app build, so two
// routes exist: with FCM_SERVICE_ACCOUNT_JSON the instance calls Firebase itself
// (it owns the project), with MOBILE_PUSH_RELAY_URL it goes through the push relay
// of the published app (deploy/push-relay). Neither set: no push, and the app
// relies on Socket.io in the foreground and background polling otherwise.
import { createSign } from "node:crypto";
import { logger } from "@/lib/logger";
import { isDemoMode } from "@/lib/demo";
import { getConfigValue, getConfigValues } from "./config-service";
import { clearPushToken, getPushTokens } from "./mobile-service";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Every call to Google or the relay gives up after this delay: a push is never worth a hung request. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Overridable for development and tests only (mock server), like OPENROUTER_BASE_URL. */
function oauthUrl(): string {
  return process.env.FCM_OAUTH_URL?.trim() || "https://oauth2.googleapis.com/token";
}

function fcmBaseUrl(): string {
  return process.env.FCM_BASE_URL?.trim() || "https://fcm.googleapis.com";
}

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;
// Last invalid value reported: GET /api/mobile/info (public) reads it on every call
let reportedInvalid: string | null = null;

/** The service account of a JSON key file, null when it is not one. */
export function readServiceAccount(raw: string): ServiceAccount | null {
  try {
    const account = JSON.parse(raw) as Partial<ServiceAccount> | null;
    if (typeof account?.project_id === "string" && typeof account.client_email === "string" && typeof account.private_key === "string"
      && account.project_id && account.client_email && account.private_key.includes("PRIVATE KEY")) {
      return account as ServiceAccount;
    }
  } catch { /* not JSON */ }
  return null;
}

function parseServiceAccount(raw: string | null): ServiceAccount | null {
  if (!raw) return null;
  const account = readServiceAccount(raw);
  if (account) return account;
  if (reportedInvalid !== raw) {
    reportedInvalid = raw;
    logger.error("push", "FCM_SERVICE_ACCOUNT_JSON is not a valid service account");
  }
  return null;
}

async function relaySettings(): Promise<{ url: string; key: string | null } | null> {
  const config = await getConfigValues(["MOBILE_PUSH_RELAY_URL", "MOBILE_PUSH_RELAY_KEY"]);
  const url = config.MOBILE_PUSH_RELAY_URL?.trim().replace(/\/+$/, "");
  return url ? { url, key: config.MOBILE_PUSH_RELAY_KEY?.trim() || null } : null;
}

export async function isPushConfigured(): Promise<boolean> {
  // A demo instance sends nothing outside (src/lib/demo)
  if (isDemoMode()) return false;
  if (parseServiceAccount(await getConfigValue("FCM_SERVICE_ACCOUNT_JSON"))) return true;
  return (await relaySettings()) !== null;
}

/** Signed assertion exchanged for an access token (service account flow). */
export function buildServiceAccountJwt(account: Pick<ServiceAccount, "client_email" | "private_key">, nowSeconds: number, audience: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = { iss: account.client_email, scope: SCOPE, aud: audience, iat: nowSeconds, exp: nowSeconds + 3600 };
  const unsigned = [encode({ alg: "RS256", typ: "JWT" }), encode(claims)].join(".");
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken?.email === account.client_email && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const url = oauthUrl();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildServiceAccountJwt(account, Math.floor(now / 1000), url),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OAuth token refused: HTTP ${response.status}`); // i18n-ignore log only
  const { access_token: token, expires_in: expiresIn } = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { email: account.client_email, token, expiresAt: now + expiresIn * 1000 };
  return token;
}

/** High-priority data message to a FID: wakes the app even in Doze, with no content to show. */
export function buildWakeUpMessage(fid: string, alertId: string) {
  return {
    message: {
      fid,
      android: { priority: "HIGH", ttl: "86400s" },
      data: { alertId },
    },
  };
}

/**
 * Firebase no longer knows this installation (app uninstalled, data cleared,
 * FID unregistered): the error body of HTTP v1 carries an `FcmError` detail
 * with `errorCode: "UNREGISTERED"`. Any other refusal (a 404 of a wrong
 * project or URL among them) says nothing about the device.
 */
export function isUnregisteredError(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return Array.isArray(details) && details.some((detail) => (detail as { errorCode?: unknown } | null)?.errorCode === "UNREGISTERED");
}

/** The relay's answer when Firebase reported the installation as unregistered (deploy/push-relay). */
export function isRelayUnregistered(status: number, body: unknown): boolean {
  return status === 410 && (body as { error?: unknown } | null)?.error === "unregistered";
}

type PushOutcome = "sent" | "unregistered" | "failed";

async function sendDirect(account: ServiceAccount, pushToken: string, alertId: string): Promise<PushOutcome> {
  const response = await fetch(`${fcmBaseUrl()}/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken(account)}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildWakeUpMessage(pushToken, alertId)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.ok) return "sent";
  if (isUnregisteredError(await response.json().catch(() => null))) return "unregistered";
  logger.warn("push", "Push failed", { status: response.status });
  return "failed";
}

async function sendThroughRelay(relay: { url: string; key: string | null }, pushToken: string, alertId: string): Promise<PushOutcome> {
  const response = await fetch(`${relay.url}/v1/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(relay.key ? { Authorization: `Bearer ${relay.key}` } : {}) },
    body: JSON.stringify({ fid: pushToken, alertId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.ok) return "sent";
  if (isRelayUnregistered(response.status, await response.json().catch(() => null))) return "unregistered";
  logger.warn("push", "Push failed", { status: response.status });
  return "failed";
}

/** Wakes up every device of a user. Number of devices reached. */
export async function sendMobilePush(userId: string, alertId: string): Promise<number> {
  if (isDemoMode()) return 0;
  const account = parseServiceAccount(await getConfigValue("FCM_SERVICE_ACCOUNT_JSON"));
  const relay = account ? null : await relaySettings();
  if (!account && !relay) return 0;

  const devices = await getPushTokens([userId]);
  const results = await Promise.allSettled(devices.map(async ({ pushToken }) => {
    const outcome = account ? await sendDirect(account, pushToken, alertId) : await sendThroughRelay(relay!, pushToken, alertId);
    // Only Firebase's UNREGISTERED forgets the token: the device stays signed in
    // and sends its new FID from `onRegistered`
    if (outcome === "unregistered") await clearPushToken(pushToken);
    return outcome === "sent";
  }));
  for (const result of results) {
    if (result.status === "rejected") logger.error("push", "Push failed", { error: String(result.reason) });
  }
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}
