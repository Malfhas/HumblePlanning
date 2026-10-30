import { db } from "@/db";
import { users, projects } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { notifyPushRecipients } from "./push-notification-service";
import { getTriggersFromTaskChanges } from "./notification-triggers";
import { getConfigValue } from "./config-service";
import { groupByRecipientLocale } from "./notification-service";
import { getServerTranslator, translateKey } from "@/i18n/server-translator";
import { DEFAULT_DATE_SETTINGS, formatDate } from "@/lib/utils/dates";
import type { AppLocale } from "@/i18n/config";
import { logger } from "@/lib/logger";

interface TaskData {
  id: string;
  title: string;
  startDate: string;
  endDate?: string | null;
  projectId?: string | null;
}

type PushParams = Record<string, string | number>;

/**
 * Text of an in-app notification: message key + RAW parameters (ISO
 * dates), translated at display time in the reader's language
 * (`useNotificationText`). `title` / `message` are also written in each
 * recipient's language, as a fallback (old clients, API).
 */
interface PushText {
  /** "Project — Task" (data); null → generic key `notifications.task.untitled`. */
  title: string | null;
  messageKey: string;
  params: PushParams;
}

const UNTITLED_KEY = "notifications.task.untitled";

/** Date parameters (`date`, `*Date`, in ISO): same convention as `useNotificationText`. */
const DATE_PARAM_RE = /(^date$|Date$)/;

/** Resolve project name and actor display name for richer notifications. */
async function resolveContext(projectId?: string | null, actorId?: string) {
  const [project, actor] = await Promise.all([
    projectId
      ? db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { name: true } })
      : null,
    actorId
      ? db.query.users.findFirst({ where: eq(users.id, actorId), columns: { name: true, firstName: true } })
      : null,
  ]);
  const projectName = project?.name ?? null;
  const actorName = actor ? [actor.firstName, actor.name].filter(Boolean).join(" ") : null;
  return { projectName, actorName };
}

function buildTitle(projectName: string | null, taskTitle: string): string | null {
  if (projectName && taskTitle) return `${projectName} — ${taskTitle}`;
  if (projectName) return projectName;
  if (taskTitle) return taskTitle;
  return null;
}

/**
 * Key `notifications.task.<key>` (known author) or `<key>NoActor` (no author):
 * two messages rather than an optional parameter, simpler to translate.
 */
// i18n-dynamic: notifications.task.*
function taskMessage(key: string, actorName: string | null, params: PushParams = {}): Omit<PushText, "title"> {
  return actorName
    ? { messageKey: `notifications.task.${key}`, params: { ...params, actor: actorName } } // i18n-ignore dynamic key
    : { messageKey: `notifications.task.${key}NoActor`, params }; // i18n-ignore dynamic key
}

function formatParams(params: PushParams, locale: AppLocale, dateFormat: string): PushParams {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, DATE_PARAM_RE.test(k) && typeof v === "string" ? formatDate(v, locale, dateFormat) : v]),
  );
}

/**
 * Sends an in-app notification, written once per recipient language
 * (`users.locale`, otherwise the instance language). Filtering (global setting,
 * trigger, preferences, author excluded) stays that of `notifyPushRecipients`.
 */
async function sendLocalizedPush(
  base: { type: string; actionUrl?: string; recipientIds: string[]; actorId?: string },
  text: PushText,
) {
  const [recipients, dateFormat] = await Promise.all([
    db.select({ id: users.id, locale: users.locale }).from(users).where(inArray(users.id, base.recipientIds)),
    getConfigValue("PLANNING_DATE_FORMAT"),
  ]);
  for (const [locale, group] of await groupByRecipientLocale(recipients)) {
    const t = await getServerTranslator(locale);
    const params = formatParams(text.params, locale, dateFormat || DEFAULT_DATE_SETTINGS.dateFormat);
    await notifyPushRecipients({
      ...base,
      recipientIds: group.map((r) => r.id),
      title: text.title ?? translateKey(t, UNTITLED_KEY) ?? UNTITLED_KEY,
      message: translateKey(t, text.messageKey, params) ?? text.messageKey,
      titleKey: text.title === null ? UNTITLED_KEY : null,
      messageKey: text.messageKey,
      params: text.params,
    });
  }
}

export function schedulePushTaskCreated(
  task: TaskData,
  userIds: string[],
  creatorId?: string,
) {
  if (userIds.length === 0) return;
  (async () => {
    const { projectName, actorName } = await resolveContext(task.projectId, creatorId);
    await sendLocalizedPush(
      { type: "task_created", actionUrl: `/tasks?id=${task.id}`, recipientIds: userIds, actorId: creatorId },
      { title: buildTitle(projectName, task.title), ...taskMessage("assigned", actorName, { date: task.startDate }) },
    );
  })().catch((err) => logger.error("push", "Failed to send push task created", { error: err instanceof Error ? err.message : String(err) }));
}

/** Change trigger → message `notifications.task.changed.<key>`. */
const TRIGGER_CHANGE_KEYS: Record<string, string> = {
  task_title_changed: "title",
  task_dates_changed: "dates",
  task_times_changed: "times",
  task_status_changed: "status",
  task_project_changed: "project",
  task_notes_changed: "notes",
};

export function schedulePushTaskUpdated(
  task: TaskData,
  oldTask: Record<string, unknown>,
  userIds: string[],
  modifierId?: string,
) {
  if (userIds.length === 0) return;
  // Detect which fields changed and emit one push per active trigger
  const changedTriggers = getTriggersFromTaskChanges(oldTask, task as unknown as Record<string, unknown>);

  // Also detect user added/removed
  const oldUserIds = (oldTask.userIds as string[] | undefined) ?? [];
  const newUserIds = (task as unknown as Record<string, unknown>).userIds as string[] | undefined;
  const addedUsers: string[] = [];
  const removedUsers: string[] = [];
  if (newUserIds) {
    for (const id of newUserIds) if (!oldUserIds.includes(id)) addedUsers.push(id);
    for (const id of oldUserIds) if (!newUserIds.includes(id)) removedUsers.push(id);
  }

  if (changedTriggers.length === 0 && addedUsers.length === 0 && removedUsers.length === 0) return;

  (async () => {
    const { projectName, actorName } = await resolveContext(task.projectId, modifierId);
    const title = buildTitle(projectName, task.title);

    // Emit one push per detected change type
    for (const trigger of changedTriggers) {
      const changeKey = TRIGGER_CHANGE_KEYS[trigger] ?? "other";
      await sendLocalizedPush(
        { type: trigger, actionUrl: `/tasks?id=${task.id}`, recipientIds: userIds, actorId: modifierId },
        { title, ...taskMessage(`changed.${changeKey}`, actorName, { date: task.startDate }) },
      );
    }

    // task_user_added — sent ONLY to newly added users
    if (addedUsers.length > 0) {
      await sendLocalizedPush(
        { type: "task_user_added", actionUrl: `/tasks?id=${task.id}`, recipientIds: addedUsers, actorId: modifierId },
        { title, ...taskMessage("assigned", actorName, { date: task.startDate }) },
      );
    }

    // task_user_removed — sent ONLY to removed users
    if (removedUsers.length > 0) {
      await sendLocalizedPush(
        { type: "task_user_removed", recipientIds: removedUsers, actorId: modifierId },
        { title, ...taskMessage("removedFromTask", actorName) },
      );
    }
  })().catch((err) => logger.error("push", "Failed to send push task updated", { error: err instanceof Error ? err.message : String(err) }));
}

export function schedulePushTaskDeleted(
  task: TaskData,
  userIds: string[],
  deleterId?: string,
) {
  if (userIds.length === 0) return;
  (async () => {
    const { projectName, actorName } = await resolveContext(task.projectId, deleterId);
    await sendLocalizedPush(
      { type: "task_deleted", recipientIds: userIds, actorId: deleterId },
      { title: buildTitle(projectName, task.title), ...taskMessage("deleted", actorName, { date: task.startDate }) },
    );
  })().catch((err) => logger.error("push", "Failed to send push task deleted", { error: err instanceof Error ? err.message : String(err) }));
}

export function schedulePushTaskFileEvent(
  task: { id: string; title: string; startDate: string; projectId?: string | null },
  eventType: "task_file_added" | "task_file_deleted",
  fileName: string,
  userIds: string[],
  actorId?: string,
) {
  if (userIds.length === 0) return;
  const isAdded = eventType === "task_file_added";
  (async () => {
    const { projectName, actorName } = await resolveContext(task.projectId, actorId);
    await sendLocalizedPush(
      { type: eventType, actionUrl: `/tasks?id=${task.id}`, recipientIds: userIds, actorId },
      { title: buildTitle(projectName, task.title), ...taskMessage(isAdded ? "fileAdded" : "fileDeleted", actorName, { fileName }) },
    );
  })().catch((err) => logger.error("push", "Failed to send push task file event", { error: err instanceof Error ? err.message : String(err) }));
}
