import { db } from "@/db";
import { users, projects, statuses } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import { sendEmail } from "./email-service";
import { getConfigValues } from "./config-service";
import {
  taskCreatedTemplate,
  taskUpdatedTemplate,
  taskDeletedTemplate,
  type EmailRenderOptions,
  type TaskChange,
  type TaskChangeField,
} from "./email-templates";
import { logAudit } from "./audit-service";
import { getActiveTriggers, isTriggerActive } from "./notification-triggers";
import { logger } from "@/lib/logger";
import { dateSettingsFromConfig } from "@/lib/utils/dates";
import { resolveRecipientLocale } from "@/i18n/resolve-locale";
import { getServerTranslatorSync } from "@/i18n/server-translator";
import type { AppLocale } from "@/i18n/config";

// Fields that trigger a notification when changed
const SIGNIFICANT_FIELDS = [
  "title",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "statusId",
  "projectId",
  "notes",
] as const satisfies readonly TaskChangeField[];

// Mapping field name → trigger event key
const FIELD_TO_TRIGGER: Record<string, string> = {
  title: "task_title_changed",
  startDate: "task_dates_changed",
  endDate: "task_dates_changed",
  startTime: "task_times_changed",
  endTime: "task_times_changed",
  statusId: "task_status_changed",
  projectId: "task_project_changed",
  notes: "task_notes_changed",
};

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

/**
 * Groups recipients by language (`users.locale`, otherwise the instance
 * language): a template is rendered only once per language.
 */
export async function groupByRecipientLocale<T extends { locale: string | null }>(recipients: T[]): Promise<Map<AppLocale, T[]>> {
  const groups = new Map<AppLocale, T[]>();
  for (const recipient of recipients) {
    const locale = await resolveRecipientLocale(recipient.locale);
    const group = groups.get(locale);
    if (group) group.push(recipient);
    else groups.set(locale, [recipient]);
  }
  return groups;
}

async function getNotificationContext(userIds: string[], excludeUserId?: string) {
  const config = await getConfigValues([
    "NOTIFICATION_EMAIL_COCHE",
    "APP_TITLE",
    "APP_BASE_URL",
    "PLANNING_DATE_FORMAT",
    "TIME_FORMAT",
    "TIMEZONE",
  ]);

  if (config.NOTIFICATION_EMAIL_COCHE !== "true") return null;

  if (userIds.length === 0) return null;

  const allUsers = await db
    .select({ id: users.id, name: users.name, email: users.email, locale: users.locale, notifications: users.notifications, notificationsUser: users.notificationsUser })
    .from(users)
    .where(inArray(users.id, userIds));

  const recipients = allUsers.filter(
    (u) => u.notifications && u.notificationsUser && u.email && u.id !== excludeUserId
  );

  if (recipients.length === 0) return null;

  // Date settings passed explicitly to the templates (no global state on the
  // server: concurrent requests and languages); TIME_FORMAT included.
  const options: EmailRenderOptions = { dates: dateSettingsFromConfig(config) };

  return {
    recipients,
    appTitle: config.APP_TITLE || "HumblePlanning",
    baseUrl: config.APP_BASE_URL || "",
    options,
  };
}

type NotificationContext = NonNullable<Awaited<ReturnType<typeof getNotificationContext>>>;

async function getProjectInfo(projectId?: string | null) {
  if (!projectId) return null;
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { name: true, color: true },
  });
  return project || null;
}

/** Author of the action: their name, or a label translated into each recipient's language. */
type Actor = { name: string } | { labelKey: "system" | "unknown" };

async function getActor(userId?: string): Promise<Actor> {
  if (!userId) return { labelKey: "system" };
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, firstName: true },
  });
  // "First Last", like in-app notifications (push-notification-queue)
  const name = [user?.firstName, user?.name].filter(Boolean).join(" ");
  return name ? { name } : { labelKey: "unknown" };
}

// i18n-dynamic: emails.actor.*
function actorName(actor: Actor, locale: AppLocale): string {
  return "name" in actor ? actor.name : getServerTranslatorSync(locale)(`emails.actor.${actor.labelKey}`); // i18n-ignore dynamic key
}

/**
 * Renders the template once per recipient language, sends the emails, then
 * logs (audit) the successful sends.
 */
async function deliver(
  ctx: NotificationContext,
  render: (locale: AppLocale) => { subject: string; html: string },
  audit: { taskId: string; actorId?: string; eventType: string },
) {
  const sends: { email: string; result: Promise<unknown> }[] = [];
  for (const [locale, group] of await groupByRecipientLocale(ctx.recipients)) {
    const { subject, html } = render(locale);
    for (const r of group) sends.push({ email: r.email!, result: sendEmail({ to: r.email!, subject, html }) });
  }
  const results = await Promise.allSettled(sends.map((s) => s.result));
  const successEmails = sends.filter((_, i) => results[i].status === "fulfilled").map((s) => s.email);
  if (successEmails.length > 0) {
    logAudit({
      action: "email_sent",
      entityType: "task",
      entityId: audit.taskId,
      userId: audit.actorId,
      metadata: { eventType: audit.eventType, recipients: successEmails, recipientCount: successEmails.length },
    }).catch(() => {});
  }
}

export async function notifyTaskCreated(
  task: TaskData,
  userIds: string[],
  creatorId?: string
) {
  const ctx = await getNotificationContext(userIds, creatorId);
  if (!ctx) return;

  const [project, creator] = await Promise.all([
    getProjectInfo(task.projectId),
    getActor(creatorId),
  ]);

  await deliver(
    ctx,
    (locale) => taskCreatedTemplate(task, project, actorName(creator, locale), ctx.appTitle, ctx.baseUrl, locale, ctx.options),
    { taskId: task.id, actorId: creatorId, eventType: "task_created" },
  );
}

/**
 * Status or project changes: the before / after values are identifiers;
 * we replace them with the names (data, not translated) for the email.
 * Identifier not found (deleted in the meantime): left as is.
 */
async function resolveChangeNames(changes: TaskChange[]): Promise<TaskChange[]> {
  const idsOf = (field: TaskChangeField) =>
    changes.flatMap((c) => (c.kind === "field" && c.field === field ? [c.before, c.after] : []))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  const statusIds = [...new Set(idsOf("statusId"))];
  const projectIds = [...new Set(idsOf("projectId"))];
  if (statusIds.length === 0 && projectIds.length === 0) return changes;
  const [statusRows, projectRows] = await Promise.all([
    statusIds.length ? db.select({ id: statuses.id, name: statuses.name }).from(statuses).where(inArray(statuses.id, statusIds)) : [],
    projectIds.length ? db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds)) : [],
  ]);
  const names = new Map<string, string>([...statusRows, ...projectRows].map((r) => [r.id, r.name]));
  const name = (v: unknown) => (typeof v === "string" && names.get(v)) || v;
  return changes.map((c) =>
    c.kind === "field" && (c.field === "statusId" || c.field === "projectId")
      ? { ...c, before: name(c.before), after: name(c.after) }
      : c,
  );
}

export async function notifyTaskUpdated(
  task: TaskData,
  oldTask: Record<string, unknown>,
  userIds: string[],
  modifierId?: string
) {
  const triggers = await getActiveTriggers();

  // Only notify if significant fields changed AND trigger is active
  const changes: TaskChange[] = [];
  for (const field of SIGNIFICANT_FIELDS) {
    const before = oldTask[field];
    const after = (task as unknown as Record<string, unknown>)[field];
    if (String(before ?? "") !== String(after ?? "")) {
      const trigger = FIELD_TO_TRIGGER[field];
      if (trigger && !isTriggerActive(triggers, trigger)) continue;
      changes.push({ kind: "field", field, before, after });
    }
  }

  // Check userIds changes (add/remove)
  const oldUserIds = (oldTask.userIds as string[] | undefined) ?? [];
  const newUserIds = (task as unknown as Record<string, unknown>).userIds as string[] | undefined;
  if (newUserIds) {
    const added = newUserIds.filter((id) => !oldUserIds.includes(id));
    const removed = oldUserIds.filter((id) => !newUserIds.includes(id));
    if (added.length > 0 && isTriggerActive(triggers, "task_user_added")) {
      changes.push({ kind: "usersAdded", count: added.length });
    }
    if (removed.length > 0 && isTriggerActive(triggers, "task_user_removed")) {
      changes.push({ kind: "usersRemoved", count: removed.length });
    }
  }

  if (changes.length === 0) return;

  const ctx = await getNotificationContext(userIds, modifierId);
  if (!ctx) return;

  const [project, modifier, namedChanges] = await Promise.all([
    getProjectInfo(task.projectId),
    getActor(modifierId),
    resolveChangeNames(changes),
  ]);

  await deliver(
    ctx,
    (locale) => taskUpdatedTemplate(task, project, namedChanges, actorName(modifier, locale), ctx.appTitle, ctx.baseUrl, locale, ctx.options),
    { taskId: task.id, actorId: modifierId, eventType: "task_updated" },
  );
}

export async function notifyTaskDeleted(
  task: TaskData,
  userIds: string[],
  deleterId?: string
) {
  const ctx = await getNotificationContext(userIds, deleterId);
  if (!ctx) return;

  const [project, deleter] = await Promise.all([
    getProjectInfo(task.projectId),
    getActor(deleterId),
  ]);

  await deliver(
    ctx,
    (locale) => taskDeletedTemplate(task, project, actorName(deleter, locale), ctx.appTitle, ctx.baseUrl, locale, ctx.options),
    { taskId: task.id, actorId: deleterId, eventType: "task_deleted" },
  );
}

export async function notifyTaskFileEvent(
  task: TaskData,
  eventType: "task_file_added" | "task_file_deleted",
  fileName: string,
  userIds: string[],
  actorId?: string
) {
  logger.info("email", `notifyTaskFileEvent: eventType=${eventType} taskId=${task.id}`, { userIds, actorId });

  const triggers = await getActiveTriggers();
  if (!isTriggerActive(triggers, eventType)) {
    logger.info("email", `Trigger ${eventType} is not active, skipping`);
    return;
  }

  const change: TaskChange = { kind: eventType === "task_file_added" ? "fileAdded" : "fileDeleted", fileName };

  const ctx = await getNotificationContext(userIds, actorId);
  if (!ctx) {
    logger.info("email", "No notification context (notifications disabled or no eligible recipients)");
    return;
  }
  logger.info("email", `${ctx.recipients.length} recipients for file event`);

  const [project, actor] = await Promise.all([
    getProjectInfo(task.projectId),
    getActor(actorId),
  ]);

  await deliver(
    ctx,
    (locale) => taskUpdatedTemplate(task, project, [change], actorName(actor, locale), ctx.appTitle, ctx.baseUrl, locale, ctx.options),
    { taskId: task.id, actorId, eventType },
  );
}
