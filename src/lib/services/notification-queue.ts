import { db } from "@/db";
import { users, projects } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getConfigValues } from "./config-service";
import { notifyTaskCreated, notifyTaskUpdated, notifyTaskDeleted } from "./notification-service";
import { getActiveTriggers, getActiveSmsTriggers, isTriggerActive, getTriggersFromTaskChanges } from "./notification-triggers";
import { sendSentMessage, SMS_FEATURE_ENABLED } from "./sent-service";
import { logger } from "@/lib/logger";
import { resolveRecipientLocale } from "@/i18n/resolve-locale";
import { getServerTranslatorSync } from "@/i18n/server-translator";

interface SmsRecipient {
  id: string;
  mobile: string;
  locale: string | null;
}

/** SMS event: only its label is translated (the template lives at Sent.dm). */
type SmsEvent = "created" | "updated" | "deleted";

/** Filter userIds to only those with SMS notifications enabled and a valid mobile */
async function getEligibleSmsRecipients(userIds: string[], excludeUserId?: string): Promise<SmsRecipient[]> {
  if (userIds.length === 0) return [];
  if (!SMS_FEATURE_ENABLED) return []; // Feature disabled — skip DB query entirely

  const config = await getConfigValues(["NOTIFICATION_SMS_ENABLED"]);
  if (config.NOTIFICATION_SMS_ENABLED !== "true") return [];

  const allUsers = await db
    .select({
      id: users.id,
      mobile: users.mobile,
      smsNotifications: users.smsNotifications,
      smsNotificationsUser: users.smsNotificationsUser,
      locale: users.locale,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  return allUsers
    .filter((u) => u.smsNotifications && u.smsNotificationsUser && u.mobile && u.id !== excludeUserId && /^\+\d{6,15}$/.test(u.mobile))
    .map((u) => ({ id: u.id, mobile: u.mobile!, locale: u.locale }));
}

/** Send SMS notifications via Sent.dm (fire-and-forget) */
// i18n-dynamic: notifications.sms.events.*
async function sendSmsNotifications(event: SmsEvent, taskTitle: string, projectName: string, recipients: SmsRecipient[]) {
  if (recipients.length === 0) return;
  const appConfig = await getConfigValues(["APP_TITLE", "APP_BASE_URL"]);
  const appTitle = appConfig.APP_TITLE || "HumblePlanning";
  const appUrl = appConfig.APP_BASE_URL || "";
  for (const r of recipients) {
    // Event label in the recipient's language
    const eventLabel = getServerTranslatorSync(await resolveRecipientLocale(r.locale))(`notifications.sms.events.${event}`); // i18n-ignore dynamic key
    sendSentMessage({
      phoneNumber: r.mobile,
      templateVariables: { "1": appTitle, "2": eventLabel, "3": projectName, "4": taskTitle, "5": appUrl },
    }).catch((err) => {
      logger.error("sms", "SMS notification failed", {
        recipient: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

async function getProjectName(projectId?: string | null): Promise<string> {
  if (!projectId) return "—";
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { name: true },
  });
  return project?.name || "—";
}

interface TaskData {
  id: string;
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
  projectId?: string | null;
  statusId?: string | null;
}

interface PendingNotification {
  timer: ReturnType<typeof setTimeout>;
  type: "created" | "updated";
  task: TaskData;
  oldTask?: Record<string, unknown>;
  recipientIds: string[];
  actorId?: string;
}

const pendingMap = new Map<string, PendingNotification>();

/** Filter userIds to only those with notifications enabled and an email set */
async function getEligibleRecipientIds(userIds: string[], excludeUserId?: string): Promise<string[]> {
  if (userIds.length === 0) return [];

  const config = await getConfigValues(["NOTIFICATION_EMAIL_COCHE"]);
  if (config.NOTIFICATION_EMAIL_COCHE !== "true") return [];

  const allUsers = await db
    .select({ id: users.id, email: users.email, notifications: users.notifications, notificationsUser: users.notificationsUser })
    .from(users)
    .where(inArray(users.id, userIds));

  return allUsers
    .filter((u) => u.notifications && u.notificationsUser && u.email && u.id !== excludeUserId)
    .map((u) => u.id);
}

function cancelPending(taskId: string) {
  const pending = pendingMap.get(taskId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingMap.delete(taskId);
  }
}

async function flush(taskId: string) {
  const pending = pendingMap.get(taskId);
  if (!pending) return;
  pendingMap.delete(taskId);

  try {
    if (pending.type === "created") {
      await notifyTaskCreated(pending.task, pending.recipientIds, pending.actorId);
    } else {
      await notifyTaskUpdated(
        pending.task,
        pending.oldTask || {},
        pending.recipientIds,
        pending.actorId
      );
    }
  } catch (err) {
    logger.error("email", "Notification queue flush error", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function queueNotification(
  type: "created" | "updated",
  task: TaskData,
  userIds: string[],
  actorId?: string,
  oldTask?: Record<string, unknown>
) {
  // Check eligible recipients upfront — no recipient = no timer
  const recipientIds = await getEligibleRecipientIds(userIds, actorId);
  logger.info("email", `Notification queue ${type} task=${task.id}`, { userIds, actorId, recipientIds });
  if (recipientIds.length === 0) {
    // Still cancel any pending notification (user may have toggled notifications off)
    cancelPending(task.id);
    return;
  }

  const config = await getConfigValues(["EMAIL_SEND_DELAY"]);
  const delay = parseInt(config.EMAIL_SEND_DELAY || "60", 10);

  // Cancel any pending notification for this task
  cancelPending(task.id);

  // Immediate send if delay is 0
  if (delay <= 0) {
    try {
      if (type === "created") {
        await notifyTaskCreated(task, recipientIds, actorId);
      } else {
        await notifyTaskUpdated(task, oldTask || {}, recipientIds, actorId);
      }
    } catch (err) {
      logger.error("email", "Notification queue immediate send error", { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // Queue with debounce
  const timer = setTimeout(() => flush(task.id), delay * 1000);
  pendingMap.set(task.id, { timer, type, task, oldTask, recipientIds, actorId });
}

async function dispatchSms(event: SmsEvent, task: TaskData, userIds: string[], actorId: string | undefined, eventTriggers: string[]) {
  try {
    const activeSmsTriggers = await getActiveSmsTriggers();
    // Check if at least one of the events activated by this update is in the active SMS triggers
    const hasActiveTrigger = eventTriggers.some((t) => isTriggerActive(activeSmsTriggers, t));
    if (!hasActiveTrigger) return;
    const recipients = await getEligibleSmsRecipients(userIds, actorId);
    if (recipients.length === 0) return;
    const projectName = await getProjectName(task.projectId);
    sendSmsNotifications(event, task.title, projectName, recipients);
  } catch (err) {
    logger.error("sms", "Failed to dispatch SMS notification", { error: err instanceof Error ? err.message : String(err) });
  }
}

export function scheduleTaskCreated(
  task: TaskData,
  userIds: string[],
  creatorId?: string
) {
  getActiveTriggers().then((triggers) => {
    if (isTriggerActive(triggers, "task_created")) {
      queueNotification("created", task, userIds, creatorId).catch((err) => logger.error("email", "Failed to queue task created notification", { error: err instanceof Error ? err.message : String(err) }));
    }
  }).catch((err) => logger.error("email", "Failed to get active triggers for task created", { error: err instanceof Error ? err.message : String(err) }));

  // SMS dispatch (independent triggers)
  dispatchSms("created", task, userIds, creatorId, ["task_created"]);
}

export function scheduleTaskUpdated(
  task: TaskData,
  oldTask: Record<string, unknown>,
  userIds: string[],
  modifierId?: string
) {
  queueNotification("updated", task, userIds, modifierId, oldTask).catch((err) => logger.error("email", "Failed to queue task updated notification", { error: err instanceof Error ? err.message : String(err) }));

  // SMS dispatch — determine which fields changed and dispatch accordingly
  const changedTriggers = getTriggersFromTaskChanges(oldTask, task as unknown as Record<string, unknown>);
  if (changedTriggers.length > 0) {
    dispatchSms("updated", task, userIds, modifierId, changedTriggers);
  }
}

export function scheduleTaskDeleted(
  task: TaskData,
  userIds: string[],
  deleterId?: string
) {
  // Cancel any pending notification
  cancelPending(task.id);

  getActiveTriggers().then((triggers) => {
    if (!isTriggerActive(triggers, "task_deleted")) return;

    // Check recipients upfront for delete too
    getEligibleRecipientIds(userIds, deleterId).then((recipientIds) => {
      if (recipientIds.length === 0) return;
      notifyTaskDeleted(task, recipientIds, deleterId).catch((err) => logger.error("email", "Failed to send task deleted notification", { error: err instanceof Error ? err.message : String(err) }));
    }).catch((err) => logger.error("email", "Failed to get eligible recipients for task deleted", { error: err instanceof Error ? err.message : String(err) }));
  }).catch((err) => logger.error("email", "Failed to get active triggers for task deleted", { error: err instanceof Error ? err.message : String(err) }));

  // SMS dispatch
  dispatchSms("deleted", task, userIds, deleterId, ["task_deleted"]);
}
