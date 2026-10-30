import crypto from "node:crypto";
import { db } from "@/db";
import { webhookLogs } from "@/db/schema";
import { sql, desc, gte, and, eq } from "drizzle-orm";
import { getConfigValue, setConfigValue } from "./config-service";

const REPLAY_WINDOW_SECONDS = 5 * 60; // 5 minutes

/**
 * Verify a Nuntly webhook signature.
 * Header format: "t={unix_seconds},v0={sig1},{sig2}"
 * Signed content: "{timestamp}.{raw_body}"
 * Algo: HMAC-SHA256
 * Secret: prefixed with "whsec_" — strip before HMAC.
 */
export function verifyNuntlySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): { valid: boolean; reason?: string; timestamp?: number } {
  if (!signatureHeader) return { valid: false, reason: "missing signature header" };
  if (!secret) return { valid: false, reason: "secret not configured" };

  // Parse "t={unix_seconds},v0={sig1},{sig2}..."
  const parts = signatureHeader.split(",").map((s) => s.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    if (part.startsWith("t=")) {
      const t = parseInt(part.slice(2), 10);
      if (!Number.isNaN(t)) timestamp = t;
    } else if (part.startsWith("v0=")) {
      signatures.push(part.slice(3));
    }
  }

  if (timestamp === null) return { valid: false, reason: "missing timestamp" };
  if (signatures.length === 0) return { valid: false, reason: "missing signature value" };

  // Replay protection
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
    return { valid: false, reason: "timestamp too old", timestamp };
  }

  // Strip "whsec_" prefix if present
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const signedContent = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", rawSecret)
    .update(signedContent)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  for (const sig of signatures) {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return { valid: true, timestamp };
      }
    } catch {
      // invalid hex, skip
    }
  }

  return { valid: false, reason: "signature mismatch", timestamp };
}

/**
 * Log a webhook event to the database. Fire-and-forget.
 */
export async function logWebhookEvent(params: {
  provider: string;
  eventType: string;
  eventId?: string | null;
  recipient?: string | null;
  messageId?: string | null;
  status: "received" | "processed" | "error" | "invalid_signature" | "rate_limited";
  errorMessage?: string;
  payload?: unknown;
}): Promise<void> {
  try {
    await db.insert(webhookLogs).values({
      provider: params.provider,
      eventType: params.eventType,
      eventId: params.eventId ?? null,
      recipient: params.recipient ?? null,
      messageId: params.messageId ?? null,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      payload: (params.payload as never) ?? null,
    });
  } catch (err) {
    console.error("[webhook] Failed to log event:", err);
  }
}

/**
 * Update the timestamp of the last received Nuntly event (for status display).
 */
export async function updateNuntlyLastReceived(): Promise<void> {
  await setConfigValue("NUNTLY_WEBHOOK_LAST_RECEIVED_AT", new Date().toISOString());
}

/**
 * Webhook status for the settings UI.
 */
export interface WebhookStatus {
  secretConfigured: boolean;
  lastReceivedAt: string | null;
  events24h: number;
  errors24h: number;
}

export async function getNuntlyWebhookStatus(): Promise<WebhookStatus> {
  const secret = await getConfigValue("NUNTLY_WEBHOOK_SECRET");
  const lastReceived = await getConfigValue("NUNTLY_WEBHOOK_LAST_RECEIVED_AT");

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ events24h, errors24h }] = await db
    .select({
      events24h: sql<number>`count(*)::int`.as("events24h"),
      errors24h: sql<number>`count(*) FILTER (WHERE ${webhookLogs.status} IN ('error', 'invalid_signature'))::int`.as("errors24h"),
    })
    .from(webhookLogs)
    .where(and(eq(webhookLogs.provider, "nuntly"), gte(webhookLogs.receivedAt, oneDayAgo)));

  return {
    secretConfigured: !!secret && secret.length > 0,
    lastReceivedAt: lastReceived,
    events24h: events24h ?? 0,
    errors24h: errors24h ?? 0,
  };
}

/**
 * Paginated list of webhook logs for the settings UI.
 */
export async function getWebhookLogs(provider: string, page: number, limit: number) {
  const offset = (page - 1) * limit;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int`.as("total") })
    .from(webhookLogs)
    .where(eq(webhookLogs.provider, provider));

  const data = await db
    .select()
    .from(webhookLogs)
    .where(eq(webhookLogs.provider, provider))
    .orderBy(desc(webhookLogs.receivedAt))
    .limit(limit)
    .offset(offset);

  return { data, total: total ?? 0, page, limit };
}

/**
 * In-memory rate limiter for webhook endpoint.
 * 200 req/min per IP — generous because Nuntly may batch send many events
 * after a mass mailing campaign.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 200;
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkWebhookRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

// Cleanup old buckets every 5 min
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of ipBuckets) {
      if (bucket.resetAt < now) ipBuckets.delete(ip);
    }
  }, 5 * 60_000);
}
