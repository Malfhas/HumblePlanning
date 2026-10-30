import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { eq, and, desc, inArray, lte, sql, count } from "drizzle-orm";
import { getConfigValues } from "./config-service";
import { emitPushNotification } from "@/lib/socket-events";
import { getActivePushTriggers, isPushTriggerActive } from "./push-notification-triggers";
import { logger } from "@/lib/logger";

// Throttle: run retention purge at most once per hour
let lastRetentionCheck = 0;

async function applyRetentionPolicy() {
  const now = Date.now();
  if (now - lastRetentionCheck < 3600_000) return;
  lastRetentionCheck = now;

  const row = await db.query.appConfig.findFirst({
    where: eq((await import("@/db/schema")).appConfig.key, "PUSH_RETENTION_DAYS"),
  });
  const days = parseInt(row?.value ?? "30", 10);
  if (!days || days <= 0) return; // 0 = unlimited

  const cutoff = new Date(now - days * 86400_000);
  await db.delete(notifications).where(lte(notifications.createdAt, cutoff));
}

export async function getUserNotifications(userId: string, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const [data, [countResult], unreadResult] = await Promise.all([
    db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(notifications)
      .where(eq(notifications.userId, userId)),
    db.select({ count: count() }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false))),
  ]);

  return {
    data,
    total: Number(countResult.count),
    unreadCount: Number(unreadResult[0].count),
    page,
    limit,
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [result] = await db.select({ count: count() }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return Number(result.count);
}

export async function markAsRead(userId: string, notifId: string) {
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, userId)));
}

export async function markAllAsRead(userId: string) {
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}

export async function deleteNotification(userId: string, notifId: string) {
  await db.delete(notifications)
    .where(and(eq(notifications.id, notifId), eq(notifications.userId, userId)));
}

export async function deleteAllNotifications(userId: string) {
  await db.delete(notifications).where(eq(notifications.userId, userId));
}

export async function createPushNotification(params: {
  userId: string;
  type: string;
  title: string;
  message: string;
  /** Message keys + raw parameters, translated at display time (fallback: title / message). */
  titleKey?: string | null;
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
  actionUrl?: string;
}) {
  const [notif] = await db.insert(notifications).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    titleKey: params.titleKey ?? null,
    messageKey: params.messageKey ?? null,
    params: params.params ?? null,
    actionUrl: params.actionUrl,
  }).returning();

  // Emit via Socket.io for real-time delivery
  emitPushNotification(params.userId, notif);

  // Fire-and-forget retention
  applyRetentionPolicy().catch(() => {});

  return notif;
}

export async function notifyPushRecipients(params: {
  type: string;
  title: string;
  message: string;
  /** `notifications.*` keys + raw parameters, translated at display time (fallback: title / message). */
  titleKey?: string | null;
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
  actionUrl?: string;
  recipientIds: string[];
  actorId?: string;
}) {
  // Check global toggle
  const config = await getConfigValues(["NOTIFICATION_PUSH_ENABLED"]);
  if (config.NOTIFICATION_PUSH_ENABLED !== "true") return;

  // Check trigger is active
  const triggers = await getActivePushTriggers();
  if (!isPushTriggerActive(triggers, params.type)) return;

  // Filter users with pushNotifications enabled, exclude actor
  const eligibleUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, params.recipientIds));

  const filtered = eligibleUsers
    .filter((u) => u.id !== params.actorId)
    .map((u) => u.id);

  if (filtered.length === 0) return;

  // Check per-user pushNotifications toggle (admin master + user preference)
  const usersWithPush = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      inArray(users.id, filtered),
      eq(users.pushNotifications, true),
      eq(users.pushNotificationsUser, true),
    ));

  const pushUserIds = usersWithPush.map((u) => u.id);
  if (pushUserIds.length === 0) return;

  // Bulk insert
  const values = pushUserIds.map((userId) => ({
    userId,
    type: params.type,
    title: params.title,
    message: params.message,
    titleKey: params.titleKey ?? null,
    messageKey: params.messageKey ?? null,
    params: params.params ?? null,
    actionUrl: params.actionUrl,
  }));

  const inserted = await db.insert(notifications).values(values).returning();

  // Emit to each user via Socket.io
  for (const notif of inserted) {
    emitPushNotification(notif.userId, notif);
  }

  // Fire-and-forget retention
  applyRetentionPolicy().catch(() => {});

  logger.info("push", `Sent ${inserted.length} push notifications`, { type: params.type });
}
