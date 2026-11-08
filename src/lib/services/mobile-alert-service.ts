// Alerts sent to the mobile app when a task changes. Same levels as the e-mails:
// instance setting, triggers, per-user admin switch, the user's own preference.
import { and, asc, desc, eq, exists, gt, gte, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { mobileAlerts, mobileDevices, users } from "@/db/schema";
import { sessions } from "@/db/schema/auth";
import { emitToUser } from "@/lib/ai-chat/realtime";
import { logger } from "@/lib/logger";
import { getConfigValues } from "./config-service";
import { sendMobilePush } from "./fcm-service";
import { isPushTriggerActive } from "./push-notification-triggers";
import { MOBILE_APP_PERMISSION } from "./mobile-client-policy";
import { hasPermission, loadUserPermissions } from "./permission-service";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_ALERTS_PER_READ = 100;

let lastPurge = 0;

function purgeOldAlerts() {
  const now = Date.now();
  if (now - lastPurge < PURGE_INTERVAL_MS) return;
  lastPurge = now;
  db.delete(mobileAlerts).where(lt(mobileAlerts.createdAt, new Date(now - RETENTION_MS)))
    .catch((err) => logger.error("push", "Mobile alerts purge failed", { error: String(err) }));
}

export function parseMobileTriggers(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Real time and push for stored alerts, in the background: the in-app bell and
 * the task operation never wait for Firebase or the relay. Errors are logged.
 */
function deliverInBackground(alerts: { id: string; userId: string }[]): void {
  for (const alert of alerts) {
    Promise.all([
      emitToUser(alert.userId, "mobile:alert", { alertId: alert.id }),
      sendMobilePush(alert.userId, alert.id),
    ]).catch((err) => logger.error("push", "Mobile alert delivery failed", { error: String(err) }));
  }
}

/**
 * Records an alert for the eligible recipients having a signed-in device (its
 * session not expired), then starts its delivery without waiting for it.
 */
export async function sendMobileAlerts(params: {
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
  recipientIds: string[];
  actorId?: string;
}): Promise<void> {
  if (params.recipientIds.length === 0) return;
  const config = await getConfigValues(["MOBILE_PUSH_ENABLED", "MOBILE_PUSH_TRIGGERS"]);
  if (config.MOBILE_PUSH_ENABLED === "false") return;
  if (!isPushTriggerActive(parseMobileTriggers(config.MOBILE_PUSH_TRIGGERS), params.type)) return;

  const candidates = await db.select({ id: users.id }).from(users).where(and(
    inArray(users.id, params.recipientIds),
    params.actorId ? ne(users.id, params.actorId) : undefined,
    eq(users.mobilePushNotifications, true),
    eq(users.mobilePushNotificationsUser, true),
    exists(db.select({ id: mobileDevices.id }).from(mobileDevices)
      .innerJoin(sessions, eq(sessions.id, mobileDevices.sessionId))
      .where(and(eq(mobileDevices.userId, users.id), gt(sessions.expiresAt, new Date())))),
  ));
  // A role that lost the mobile app permission keeps its device rows until they expire: no alert for it
  const allowed = await Promise.all(candidates.map(async (c) => hasPermission(await loadUserPermissions(c.id), MOBILE_APP_PERMISSION)));
  const recipients = candidates.filter((_, i) => allowed[i]);
  if (recipients.length === 0) return;

  const inserted = await db.insert(mobileAlerts).values(recipients.map((recipient) => ({
    userId: recipient.id,
    type: params.type,
    title: params.title.slice(0, 200),
    message: params.message,
    actionUrl: params.actionUrl,
  }))).returning({ id: mobileAlerts.id, userId: mobileAlerts.userId });

  deliverInBackground(inserted);
  purgeOldAlerts();
}

/** Test alert of the app settings, whatever the event settings. Number of devices reached by push. */
export async function sendMobileTestAlert(userId: string, title: string, message: string): Promise<number> {
  const [alert] = await db.insert(mobileAlerts).values({ userId, type: "push_test", title, message }).returning({ id: mobileAlerts.id });
  await emitToUser(userId, "mobile:alert", { alertId: alert.id });
  return sendMobilePush(userId, alert.id);
}

/**
 * The user's alerts of the last 7 days, oldest first: from `after` on, or the latest
 * ones without it (the history shown in the app). `full` when the page reached the limit.
 */
export async function listMobileAlerts(userId: string, after: Date | null, now = new Date()) {
  // The purge is lazy: alerts past the retention may still be stored
  const oldest = new Date(now.getTime() - RETENTION_MS);
  const from = after && after > oldest ? after : oldest;
  const query = db.select({
    id: mobileAlerts.id,
    type: mobileAlerts.type,
    title: mobileAlerts.title,
    message: mobileAlerts.message,
    actionUrl: mobileAlerts.actionUrl,
    createdAt: mobileAlerts.createdAt,
  }).from(mobileAlerts)
    .where(and(eq(mobileAlerts.userId, userId), gte(mobileAlerts.createdAt, from)))
    .limit(MAX_ALERTS_PER_READ);
  const alerts = after
    ? await query.orderBy(asc(mobileAlerts.createdAt))
    : (await query.orderBy(desc(mobileAlerts.createdAt))).reverse();
  return { alerts, full: alerts.length === MAX_ALERTS_PER_READ };
}
