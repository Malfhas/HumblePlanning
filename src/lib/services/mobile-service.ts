// Mobile app: sessions, pairing codes and device registry. A mobile session is
// a regular Better Auth session, so every REST route and Socket.io accept it
// and it appears in the user's active sessions.
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { mobileDevices, users } from "@/db/schema";
import { sessions, verifications } from "@/db/schema/auth";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { tokenFromCookieValue, type SessionCookie } from "@/lib/utils/session-cookie";
import type { CounterPolicy } from "@/lib/utils/security-counter";
import type { MobileDevice, UpdateMobileDevice } from "@/lib/validators/mobile";
import { getConfigValues } from "./config-service";
import { logAudit } from "./audit-service";
import { recordHit } from "./security-counter-service";
import { assertMobileAppPermission } from "./mobile-client-policy";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const PAIRING_PREFIX = "mobile-pairing:";
const PAIRING_RATE_POLICY: CounterPolicy = { max: 10, windowMs: 10 * 60 * 1000, lockMs: 0 };

/**
 * Failures per client address on the mobile sign-in routes, which have no
 * captcha: on top of the per-account lockouts, slows down one address trying
 * many accounts. Exported for the routes, which count their own failures.
 */
export const MOBILE_IP_POLICY: CounterPolicy = { max: 30, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };

export function mobileIpKey(ip: string): string {
  return `mobile-login:ip:${ip}`;
}

export interface MobileSettings {
  loginEnabled: boolean;
  pairingEnabled: boolean;
}

/** Missing keys (instance not migrated yet) count as enabled. */
export async function getMobileSettings(): Promise<MobileSettings> {
  const config = await getConfigValues(["MOBILE_LOGIN_ENABLED", "MOBILE_PAIRING_ENABLED"]);
  return {
    loginEnabled: config.MOBILE_LOGIN_ENABLED !== "false",
    pairingEnabled: config.MOBILE_PAIRING_ENABLED !== "false",
  };
}

async function mobileSessionDurationMs(): Promise<number> {
  const config = await getConfigValues(["SESSION_REMEMBER_DAYS"]);
  return (parseInt(config.SESSION_REMEMBER_DAYS || "30") || 30) * 24 * 60 * 60 * 1000;
}

export interface MobileSessionPayload {
  cookieName: string;
  cookieValue: string;
  expiresAt: string;
}

/** Stores the device of a session just opened (same session: updated). */
async function saveDevice(userId: string, sessionId: string, device: MobileDevice | undefined): Promise<void> {
  const values = {
    platform: device?.platform ?? "android",
    deviceName: device?.name ?? null,
    appVersion: device?.appVersion ?? null,
    locale: device?.locale ?? null,
    lastSeenAt: new Date(),
  };
  await db.insert(mobileDevices)
    .values({ userId, sessionId, ...values })
    .onConflictDoUpdate({ target: mobileDevices.sessionId, set: values });
}

/**
 * Turns a session opened by the sign-in code into a mobile session: long
 * duration (the "remember me" one, an app has no such box) and device row.
 * A role without the mobile app permission gets no session (403).
 */
export async function finishMobileSession(cookie: SessionCookie, device: MobileDevice | undefined): Promise<MobileSessionPayload & { userId: string }> {
  const expiresAt = new Date(Date.now() + await mobileSessionDurationMs());
  const [session] = await db.update(sessions)
    .set({ expiresAt })
    .where(eq(sessions.token, tokenFromCookieValue(cookie.value)))
    .returning({ id: sessions.id, userId: sessions.userId });
  if (!session) throw new AppError("auth.errors.sessionExpired");
  try {
    await assertMobileAppPermission(session.userId);
  } catch (error) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    throw error;
  }
  await saveDevice(session.userId, session.id, device);
  return { userId: session.userId, cookieName: cookie.name, cookieValue: cookie.value, expiresAt: expiresAt.toISOString() };
}

/** Value of a Better Auth signed cookie: URL-encoded `<token>.<HMAC-SHA256 in base64>`. */
function signCookieValue(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

/** Opens a session without a password, for a verified pairing code. */
async function createSessionForUser(userId: string, ipAddress: string, userAgent: string | null): Promise<SessionCookie> {
  const context = await auth.$context;
  const token = randomBytes(24).toString("base64url");
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt: new Date(Date.now() + await mobileSessionDurationMs()),
    ipAddress,
    userAgent,
  });
  return { name: context.authCookies.sessionToken.name, value: signCookieValue(token, context.secret) };
}

function pairingIdentifier(code: string): string {
  return PAIRING_PREFIX + createHash("sha256").update(code.toLowerCase()).digest("hex");
}

/** Link read by the app (QR code): the code alone is useless without its server address. */
export function pairingLink(baseUrl: string, code: string): string {
  return `humbleplanning://login?url=${encodeURIComponent(baseUrl)}&code=${code}`;
}

/** New single-use code for the connected user (stored hashed), shown as a QR code on the web profile. */
export async function createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  await assertMobileAppPermission(userId);
  const { count } = await recordHit(`mobile-pairing:user:${userId}`, PAIRING_RATE_POLICY);
  if (count > PAIRING_RATE_POLICY.max) throw new AppError("errors.rateLimited");
  const code = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await db.insert(verifications).values({
    id: randomUUID(),
    identifier: pairingIdentifier(code),
    value: JSON.stringify({ userId }),
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Consumes a pairing code and opens a session on this device. The row is locked
 * and deleted in one transaction: a code can only be used once. Null when the
 * code is unknown, expired or used, or its account was disabled meanwhile.
 */
export async function redeemPairingCode(code: string, ipAddress: string, userAgent: string | null): Promise<SessionCookie | null> {
  const userId = await db.transaction(async (tx) => {
    const [row] = await tx.select({ id: verifications.id, value: verifications.value })
      .from(verifications)
      .where(and(eq(verifications.identifier, pairingIdentifier(code)), gt(verifications.expiresAt, new Date())))
      .for("update");
    if (!row) return null;
    await tx.delete(verifications).where(eq(verifications.id, row.id));
    return (JSON.parse(row.value) as { userId: string }).userId;
  });
  if (!userId) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { active: true } });
  if (!user || user.active === false) return null;

  const cookie = await createSessionForUser(userId, ipAddress, userAgent);
  logAudit({ userId, action: "login", entityType: "user", entityId: userId, metadata: { ip: ipAddress, userAgent, method: "mobile_pairing" } }).catch(() => {});
  return cookie;
}

/** Account flags the app must honor right after signing in. */
export async function getLoginRequirements(userId: string) {
  const [user, config] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { forcePasswordChange: true, forceTwoFactor: true, twoFactorEnabled: true },
    }),
    getConfigValues(["TWOFACTOR_REQUIRED"]),
  ]);
  return {
    forcePasswordChange: user?.forcePasswordChange ?? false,
    setupTwoFactorRequired: !user?.twoFactorEnabled && (config.TWOFACTOR_REQUIRED === "true" || !!user?.forceTwoFactor),
  };
}

export async function revokeCurrentSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function listDevices(userId: string, currentSessionId: string) {
  const rows = await db.select({
    id: mobileDevices.id,
    sessionId: mobileDevices.sessionId,
    platform: mobileDevices.platform,
    deviceName: mobileDevices.deviceName,
    appVersion: mobileDevices.appVersion,
    pushToken: mobileDevices.pushToken,
    createdAt: mobileDevices.createdAt,
    lastSeenAt: mobileDevices.lastSeenAt,
  }).from(mobileDevices)
    .where(eq(mobileDevices.userId, userId))
    .orderBy(desc(mobileDevices.lastSeenAt));
  return rows.map(({ sessionId, pushToken, ...device }) => ({
    ...device,
    pushEnabled: pushToken !== null,
    current: sessionId === currentSessionId,
  }));
}

/** Revokes the device's session (the row follows by cascade). False when it is not the user's. */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const device = await db.query.mobileDevices.findFirst({
    where: and(eq(mobileDevices.id, deviceId), eq(mobileDevices.userId, userId)),
    columns: { sessionId: true },
  });
  if (!device) return false;
  await db.delete(sessions).where(eq(sessions.id, device.sessionId));
  return true;
}

/** Updates the device of the current session; a push token moves here from any other row. */
export async function updateCurrentDevice(userId: string, sessionId: string, data: UpdateMobileDevice) {
  if (data.pushToken) {
    await db.update(mobileDevices).set({ pushToken: null }).where(eq(mobileDevices.pushToken, data.pushToken));
  }
  const set = {
    lastSeenAt: new Date(),
    ...(data.name !== undefined ? { deviceName: data.name } : {}),
    ...(data.appVersion !== undefined ? { appVersion: data.appVersion } : {}),
    ...(data.locale !== undefined ? { locale: data.locale } : {}),
    ...(data.pushToken !== undefined ? { pushToken: data.pushToken } : {}),
  };
  const [device] = await db.insert(mobileDevices)
    .values({ userId, sessionId, platform: data.platform ?? "android", ...set })
    .onConflictDoUpdate({ target: mobileDevices.sessionId, set })
    .returning({ id: mobileDevices.id, lastSeenAt: mobileDevices.lastSeenAt, pushToken: mobileDevices.pushToken });
  return { id: device.id, lastSeenAt: device.lastSeenAt, pushEnabled: device.pushToken !== null };
}

export async function getPushTokens(userIds: string[]): Promise<{ userId: string; pushToken: string }[]> {
  if (userIds.length === 0) return [];
  const rows = await db.select({ userId: mobileDevices.userId, pushToken: mobileDevices.pushToken })
    .from(mobileDevices)
    .where(and(inArray(mobileDevices.userId, userIds), isNotNull(mobileDevices.pushToken)));
  return rows.flatMap((r) => (r.pushToken ? [{ userId: r.userId, pushToken: r.pushToken }] : []));
}

export async function clearPushToken(pushToken: string): Promise<void> {
  await db.update(mobileDevices).set({ pushToken: null }).where(eq(mobileDevices.pushToken, pushToken));
}
