import { formatDate, formatDateTime, formatTime, formatWithLocale, type DateSettings } from "@/lib/utils/dates";
import { escapeHtml, escapeHtmlMultiline, safeCssColor } from "@/lib/utils/html";
import { getServerTranslatorSync, type ServerTranslator } from "@/i18n/server-translator";
import type { AppLocale } from "@/i18n/config";

// SECURITY: any user-entered data (titles, names, notes, identifiers,
// application title) is escaped before going into the HTML, including the
// parameters of `t.markup()`, which does not escape them.
// Subjects (Subject header, plain text) are not escaped.
//
// LANGUAGE: each template is rendered in the recipient's language (`locale`,
// `resolveRecipientLocale`), mandatory. No global state: the date settings
// (pattern, 24 h / 12 h, time zone) are passed by the caller (`dateSettingsFromConfig`).

interface TaskInfo {
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

interface ProjectInfo {
  name: string;
  color: string;
}

/** Display settings passed explicitly by the caller. */
export interface EmailRenderOptions {
  /** PLANNING_DATE_FORMAT, TIME_FORMAT, TIMEZONE (`dateSettingsFromConfig`). */
  dates: DateSettings;
}

/** Task fields tracked by change notifications. */
export type TaskChangeField =
  | "title"
  | "startDate"
  | "endDate"
  | "startTime"
  | "endTime"
  | "statusId"
  | "projectId"
  | "notes";

/** Structured change: labels and values are written in the recipient's language. */
export type TaskChange =
  | { kind: "field"; field: TaskChangeField; before: unknown; after: unknown }
  | { kind: "usersAdded" | "usersRemoved"; count: number }
  | { kind: "fileAdded" | "fileDeleted"; fileName: string };

/** `<b>` tag of messages → `<strong>` (parameters are already escaped). */
const strong = (chunks: string) => `<strong>${chunks}</strong>`;

function baseLayout(t: ServerTranslator, rawAppTitle: string, rawBaseUrl: string, content: string, locale: AppLocale) {
  const appTitle = escapeHtml(rawAppTitle);
  const baseUrl = escapeHtml(rawBaseUrl);
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr><td style="background:#18181b;padding:20px 24px;">
    <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${appTitle}</h1>
  </td></tr>
  <tr><td style="padding:24px;">
    ${content}
  </td></tr>
  <tr><td style="padding:16px 24px;background:#f4f4f5;text-align:center;">
    ${baseUrl ? `<a href="${baseUrl}" style="color:#3b82f6;text-decoration:none;font-size:13px;">${escapeHtml(t("emails.layout.viewPlanning"))}</a>` : ""}
    <p style="margin:8px 0 0;color:#71717a;font-size:12px;">${appTitle}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function taskDetails(t: ServerTranslator, task: TaskInfo, project: ProjectInfo | null | undefined, locale: AppLocale, settings: DateSettings) {
  const dates =
    task.endDate && task.endDate !== task.startDate
      ? `${formatDate(task.startDate, locale, settings.dateFormat)} → ${formatDate(task.endDate, locale, settings.dateFormat)}`
      : formatDate(task.startDate, locale, settings.dateFormat);

  const times =
    task.startTime && task.endTime ? ` (${formatTime(task.startTime, locale, settings.timeFormat)} – ${formatTime(task.endTime, locale, settings.timeFormat)})` : "";

  let html = `<table style="width:100%;border-collapse:collapse;margin:12px 0;">`;

  if (project) {
    // i18n-ignore HTML template: texts go through t()
    html += `<tr>
      <td style="padding:6px 0;color:#71717a;font-size:13px;width:100px;">${escapeHtml(t("emails.task.project"))}</td>
      <td style="padding:6px 0;font-size:14px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${safeCssColor(project.color)};margin-right:6px;vertical-align:middle;"></span>
        ${escapeHtml(project.name)}
      </td>
    </tr>`;
  }

  // i18n-ignore HTML template: texts go through t()
  html += `<tr>
    <td style="padding:6px 0;color:#71717a;font-size:13px;">${escapeHtml(t("emails.task.dates"))}</td>
    <td style="padding:6px 0;font-size:14px;">${escapeHtml(dates + times)}</td>
  </tr>`;

  if (task.notes) {
    // i18n-ignore HTML template: texts go through t()
    html += `<tr>
      <td style="padding:6px 0;color:#71717a;font-size:13px;vertical-align:top;">${escapeHtml(t("emails.task.notes"))}</td>
      <td style="padding:6px 0;font-size:14px;">${escapeHtmlMultiline(task.notes)}</td>
    </tr>`;
  }

  html += `</table>`;
  return html;
}

function formatChangeValue(field: TaskChangeField, value: unknown, locale: AppLocale, settings: DateSettings): string {
  if (value == null || value === "") return "";
  const raw = String(value);
  if (field === "startDate" || field === "endDate") return formatDate(raw, locale, settings.dateFormat);
  if (field === "startTime" || field === "endTime") return formatTime(raw, locale, settings.timeFormat);
  return raw;
}

/** Row of the « Modifications » list (plain text, escaped on insertion). */
// i18n-dynamic: emails.changes.fields.*
function formatChange(t: ServerTranslator, change: string | TaskChange, locale: AppLocale, settings: DateSettings): string {
  if (typeof change === "string") return change; // text already written by the caller
  switch (change.kind) {
    case "field": {
      const empty = t("emails.changes.empty");
      return t("emails.changes.field", {
        label: t(`emails.changes.fields.${change.field}`), // i18n-ignore dynamic key
        before: formatChangeValue(change.field, change.before, locale, settings) || empty,
        after: formatChangeValue(change.field, change.after, locale, settings) || empty,
      });
    }
    case "usersAdded":
      return t("emails.changes.usersAdded", { count: change.count });
    case "usersRemoved":
      return t("emails.changes.usersRemoved", { count: change.count });
    case "fileAdded":
      return t("emails.changes.fileAdded", { fileName: change.fileName });
    case "fileDeleted":
      return t("emails.changes.fileDeleted", { fileName: change.fileName });
  }
}

export function taskCreatedTemplate(
  task: TaskInfo,
  project: ProjectInfo | null,
  creatorName: string,
  appTitle = "HumblePlanning",
  baseUrl = "",
  // Recipient language (resolveRecipientLocale).
  locale: AppLocale,
  options: EmailRenderOptions,
) {
  const t = getServerTranslatorSync(locale);
  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:16px;color:#18181b;">${escapeHtml(t("emails.taskCreated.heading"))}</h2>
    <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
      ${t.markup("emails.taskCreated.intro", { actor: escapeHtml(creatorName), title: escapeHtml(task.title), b: strong })}
    </p>
    ${taskDetails(t, task, project, locale, options.dates)}
  `;
  return {
    subject: t("emails.taskCreated.subject", { appTitle, title: task.title }),
    html: baseLayout(t, appTitle, baseUrl, content, locale),
  };
}

export function taskUpdatedTemplate(
  task: TaskInfo,
  project: ProjectInfo | null,
  // Structured changes (written in the recipient's language) or already written ones.
  changes: (string | TaskChange)[],
  modifierName: string,
  appTitle = "HumblePlanning",
  baseUrl = "",
  // Recipient language (resolveRecipientLocale).
  locale: AppLocale,
  options: EmailRenderOptions,
) {
  const t = getServerTranslatorSync(locale);
  const changeList = changes
    .map((c) => `<li style="margin:2px 0;font-size:14px;">${escapeHtml(formatChange(t, c, locale, options.dates))}</li>`)
    .join("");
  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:16px;color:#18181b;">${escapeHtml(t("emails.taskUpdated.heading"))}</h2>
    <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
      ${t.markup("emails.taskUpdated.intro", { actor: escapeHtml(modifierName), title: escapeHtml(task.title), b: strong })}
    </p>
    <p style="margin:0 0 4px;color:#71717a;font-size:13px;">${escapeHtml(t("emails.taskUpdated.changesLabel"))}</p>
    <ul style="margin:0 0 16px;padding-left:20px;">${changeList}</ul>
    ${taskDetails(t, task, project, locale, options.dates)}
  `;
  return {
    subject: t("emails.taskUpdated.subject", { appTitle, title: task.title }),
    html: baseLayout(t, appTitle, baseUrl, content, locale),
  };
}

export function taskDeletedTemplate(
  task: TaskInfo,
  project: ProjectInfo | null,
  deleterName: string,
  appTitle = "HumblePlanning",
  baseUrl = "",
  // Recipient language (resolveRecipientLocale).
  locale: AppLocale,
  options: EmailRenderOptions,
) {
  const t = getServerTranslatorSync(locale);
  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:16px;color:#e11d48;">${escapeHtml(t("emails.taskDeleted.heading"))}</h2>
    <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
      ${t.markup("emails.taskDeleted.intro", { actor: escapeHtml(deleterName), title: escapeHtml(task.title), b: strong })}
    </p>
    ${taskDetails(t, task, project, locale, options.dates)}
  `;
  return {
    subject: t("emails.taskDeleted.subject", { appTitle, title: task.title }),
    html: baseLayout(t, appTitle, baseUrl, content, locale),
  };
}

export function randomPasswordTemplate(
  userName: string,
  username: string,
  password: string,
  appTitle = "HumblePlanning",
  baseUrl = "",
  // Recipient language (resolveRecipientLocale).
  locale: AppLocale,
) {
  const t = getServerTranslatorSync(locale);
  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:16px;color:#18181b;">${escapeHtml(t("emails.randomPassword.heading"))}</h2>
    <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
      ${t.markup("emails.common.greeting", { name: escapeHtml(userName), b: strong })}
    </p>
    <p style="margin:0 0 12px;color:#52525b;font-size:14px;">
      ${escapeHtml(t("emails.randomPassword.intro"))}
    </p>
    <div style="margin:0 0 16px;padding:16px;background:#f4f4f5;border-radius:6px;border:1px solid #e4e4e7;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:4px 0;color:#71717a;font-size:13px;width:120px;">${escapeHtml(t("emails.randomPassword.username"))}</td>
          <td style="padding:4px 0;font-size:15px;font-weight:600;color:#18181b;">${escapeHtml(username)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#71717a;font-size:13px;">${escapeHtml(t("emails.randomPassword.password"))}</td>
          <td style="padding:4px 0;">
            <code style="font-size:15px;font-weight:600;letter-spacing:1px;color:#18181b;">${escapeHtml(password)}</code>
          </td>
        </tr>
      </table>
    </div>
    <p style="margin:0;padding:10px 12px;background:#fef3c7;border-radius:6px;border:1px solid #fde68a;color:#92400e;font-size:13px;">
      ⚠️ ${escapeHtml(t("emails.randomPassword.changeNotice"))}
    </p>
  `;
  return {
    subject: t("emails.randomPassword.subject", { appTitle }),
    html: baseLayout(t, appTitle, baseUrl, content, locale),
  };
}

export function passwordResetTemplate(
  userName: string,
  resetUrl: string,
  expiresMinutes: number,
  appTitle = "HumblePlanning",
  baseUrl = "",
  // Recipient language (resolveRecipientLocale).
  locale: AppLocale,
) {
  const t = getServerTranslatorSync(locale);
  const resetHref = escapeHtml(resetUrl);
  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:16px;color:#18181b;">${escapeHtml(t("emails.passwordReset.heading"))}</h2>
    <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
      ${t.markup("emails.common.greeting", { name: escapeHtml(userName), b: strong })}
    </p>
    <p style="margin:0 0 16px;color:#52525b;font-size:14px;">
      ${escapeHtml(t("emails.passwordReset.intro"))}
    </p>
    <div style="margin:0 0 16px;text-align:center;">
      <a href="${resetHref}" style="display:inline-block;padding:12px 32px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        ${escapeHtml(t("emails.passwordReset.button"))}
      </a>
    </div>
    <p style="margin:0 0 16px;color:#a1a1aa;font-size:12px;">
      ${escapeHtml(t("emails.passwordReset.linkFallback"))}
    </p>
    <div style="margin:0 0 16px;padding:10px 12px;background:#f4f4f5;border-radius:6px;border:1px solid #e4e4e7;word-break:break-all;">
      <a href="${resetHref}" style="color:#3b82f6;font-size:12px;text-decoration:underline;">${resetHref}</a>
    </div>
    <p style="margin:0 0 8px;padding:10px 12px;background:#fef3c7;border-radius:6px;border:1px solid #fde68a;color:#92400e;font-size:13px;">
      ${t.markup("emails.passwordReset.expiry", { minutes: expiresMinutes, b: strong })}
    </p>
    <p style="margin:12px 0 0;color:#a1a1aa;font-size:12px;">
      ${escapeHtml(t("emails.passwordReset.ignore"))}
    </p>
  `;
  return {
    subject: t("emails.passwordReset.subject", { appTitle }),
    html: baseLayout(t, appTitle, baseUrl, content, locale),
  };
}

interface WeeklyTask {
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  files?: { id: string }[] | null;
  placeText?: string | null;
  project?: { name?: string | null; color?: string | null } | null;
  place?: { name?: string | null; color?: string | null } | null;
}

export function weeklySummaryTemplate(
  userName: string,
  tasksByDay: Map<string, WeeklyTask[]>,
  weekStart: Date,
  weekEnd: Date,
  appTitle = "HumblePlanning",
  baseUrl = "",
  // Recipient language (resolveRecipientLocale).
  locale: AppLocale,
  options: EmailRenderOptions,
) {
  const t = getServerTranslatorSync(locale);
  const startLabel = formatWithLocale(weekStart, "d MMMM", locale);
  const endLabel = formatWithLocale(weekEnd, "d MMMM yyyy", locale);

  const sortedKeys = Array.from(tasksByDay.keys()).sort();

  let dayBlocks = "";
  for (const dayKey of sortedKeys) {
    const dayDate = new Date(dayKey + "T00:00:00");
    const dayLabel = formatWithLocale(dayDate, "EEEE d MMMM yyyy", locale);
    const dayLabelCap = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
    const tasks = tasksByDay.get(dayKey) ?? [];

    let tasksHtml = "";
    if (tasks.length === 0) {
      tasksHtml = `<p style="margin:6px 0 0;color:#a1a1aa;font-size:13px;font-style:italic;">${escapeHtml(t("emails.weeklySummary.noTasks"))}</p>`; // i18n-ignore HTML template
    } else {
      tasksHtml = tasks.map((task) => {
        const projectColor = safeCssColor(task.project?.color);
        const projectName = escapeHtml(task.project?.name || "—");
        const taskTitle = task.title ? ` — ${escapeHtml(task.title)}` : "";
        const time = task.startTime && task.endTime ? `<span style="color:#71717a;font-size:12px;margin-left:6px;">${escapeHtml(`${formatTime(task.startTime, locale, options.dates.timeFormat)} – ${formatTime(task.endTime, locale, options.dates.timeFormat)}`)}</span>` : "";
        const address = task.placeText || task.place?.name;
        const addressHtml = address ? `<div style="margin-top:2px;color:#52525b;font-size:12px;">📍 ${escapeHtml(address)}</div>` : "";
        const fileCount = task.files?.length ?? 0;
        const filesHtml = fileCount > 0 ? `<div style="margin-top:2px;color:#52525b;font-size:12px;">📎 ${escapeHtml(t("emails.weeklySummary.attachments", { count: fileCount }))}</div>` : ""; // i18n-ignore HTML template

        return `<div style="padding:8px 10px;margin:6px 0;background:#f9fafb;border-left:3px solid ${projectColor};border-radius:4px;">
          <div style="font-size:13px;color:#18181b;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${projectColor};margin-right:6px;vertical-align:middle;"></span>
            <strong>${projectName}</strong>${taskTitle}${time}
          </div>
          ${addressHtml}
          ${filesHtml}
        </div>`;
      }).join("");
    }

    dayBlocks += `<div style="margin-bottom:18px;">
      <h3 style="margin:0 0 4px;font-size:14px;color:#18181b;border-bottom:1px solid #e4e4e7;padding-bottom:4px;">${escapeHtml(dayLabelCap)}</h3>
      ${tasksHtml}
    </div>`;
  }

  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:18px;color:#18181b;">${escapeHtml(t("emails.weeklySummary.heading"))}</h2>
    <p style="margin:0 0 4px;color:#52525b;font-size:14px;">
      ${escapeHtml(t("emails.weeklySummary.greeting", { name: userName }))}
    </p>
    <p style="margin:0 0 20px;color:#52525b;font-size:14px;">
      ${t.markup("emails.weeklySummary.intro", { start: escapeHtml(startLabel), end: escapeHtml(endLabel), b: strong })}
    </p>
    ${dayBlocks}
  `;

  return {
    subject: t("emails.weeklySummary.subject", { appTitle, start: startLabel, end: endLabel }),
    html: baseLayout(t, appTitle, baseUrl, content, locale),
  };
}

export function testEmailTemplate(appTitle: string, locale: AppLocale, options: EmailRenderOptions) {
  const t = getServerTranslatorSync(locale);
  // i18n-ignore HTML template: texts go through t()
  const content = `
    <h2 style="margin:0 0 8px;font-size:16px;color:#18181b;">${escapeHtml(t("emails.test.heading"))}</h2>
    <p style="margin:0;color:#52525b;font-size:14px;">
      ${t.markup("emails.test.body", { appTitle: escapeHtml(appTitle), b: strong })}
    </p>
    <p style="margin:16px 0 0;color:#71717a;font-size:12px;">
      ${escapeHtml(t("emails.test.sentAt", { date: formatDateTime(new Date(), locale, options.dates) }))}
    </p>
  `;
  return {
    subject: t("emails.test.subject", { appTitle }),
    html: baseLayout(t, appTitle, "", content, locale),
  };
}
