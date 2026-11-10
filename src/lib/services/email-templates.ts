import { formatDate, formatDateTime, formatTime, formatWithLocale, type DateSettings } from "@/lib/utils/dates";
import { escapeHtml, escapeHtmlMultiline, safeCssColor } from "@/lib/utils/html";
import { DEFAULT_THEME_COLOR, readableOnWhite, textOn, themeColor } from "@/lib/utils/theme-color";
import { getServerTranslatorSync, type ServerTranslator } from "@/i18n/server-translator";
import type { AppLocale } from "@/i18n/config";

// SECURITY: any user-entered data (titles, names, notes, identifiers,
// application title) is escaped before going into the HTML, including the
// parameters of `t.markup()`, which does not escape them.
// Subjects (Subject header, plain text) are not escaped.
//
// LANGUAGE: each template is rendered in the recipient's language (`locale`,
// `resolveRecipientLocale`), mandatory. No global state: the date settings
// (pattern, 24 h / 12 h, time zone) and the look (theme colour, logo) are
// passed by the caller (`getEmailRenderOptions`).
//
// LAYOUT: tables and inline styles, the only layout read alike by Gmail,
// Outlook and Apple Mail. A white card: logo and label, a rule in the theme
// colour, heading, text, details, button, then a footer saying the e-mail is
// automatic and not to reply to it.

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

/** Look of the e-mails, from the settings (`getEmailRenderOptions`). */
export interface EmailBrand {
  /** Theme colour (THEME_COLOR), "#rrggbb". */
  color: string;
  /** Logo served by the instance as a light PNG, shown at `width` × `height`; null: the name of the application. */
  logo: { url: string; width: number; height: number } | null;
}

/** Display settings passed explicitly by the caller. */
export interface EmailRenderOptions {
  /** PLANNING_DATE_FORMAT, TIME_FORMAT, TIMEZONE (`dateSettingsFromConfig`). */
  dates: DateSettings;
  /** Default: the HumblePlanning violet, without logo. */
  brand?: EmailBrand;
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

// ── Design tokens ──

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";
const C = {
  page: "#f4f4f7",
  card: "#ffffff",
  line: "#e6e6ec",
  text: "#18181b",
  body: "#3f3f46",
  muted: "#71717a",
  faint: "#a1a1aa",
  soft: "#f8f8fa",
  danger: "#e11d48",
};

/** The theme colour and what is drawn with it, readable whatever the colour chosen. */
interface Theme {
  /** Rules, dots, button. */
  accent: string;
  /** Text in the accent colour, on white. */
  accentText: string;
  /** Text on the accent colour (button). */
  onAccent: string;
}

function themeOf(options: EmailRenderOptions): Theme {
  const accent = themeColor(options.brand?.color ?? DEFAULT_THEME_COLOR);
  return { accent, accentText: readableOnWhite(accent), onAccent: textOn(accent) };
}

/** `<b>` tag of messages → `<strong>` (parameters are already escaped). */
const strong = (chunks: string) => `<strong style="color:${C.text};font-weight:600;">${chunks}</strong>`;

/**
 * `<b>` tag of messages left as plain text: the preview line (preheader) is the same translated sentence without
 * markup. Parameters are already escaped, the sentence stays safe in the HTML; no tag is ever stripped by a pattern.
 */
const plain = (chunks: string) => chunks;

/** Small upper-case label. */
const labelStyle = (color: string) =>
  `font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${color};`;

/** Paragraph of the body. */
const para = (html: string, margin = "0 0 14px", size = 15, color = C.body) =>
  `<p style="margin:${margin};font-family:${FONT};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color};">${html}</p>`;

/** Framed box (details of a task, changes, credentials), with an optional title in the accent colour. */
function box(inner: string, theme: Theme, title?: string, background = C.card): string {
  // i18n-ignore HTML template: texts go through t()
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;border:1px solid ${C.line};border-radius:14px;border-collapse:separate;background:${background};">
  <tr><td style="padding:16px 20px;">
    ${title ? `<p style="margin:0 0 8px;${labelStyle(theme.accentText)}">${escapeHtml(title)}</p>` : ""}
    ${inner}
  </td></tr>
</table>`;
}

/** Label / value rows (values are HTML, already escaped). */
function rows(items: [string, string][]): string {
  const cells = items
    .map(
      ([label, value]) => `<tr>
      <td width="104" valign="top" style="width:104px;padding:6px 12px 6px 0;${labelStyle(C.muted)}line-height:20px;">${escapeHtml(label)}</td>
      <td valign="top" style="padding:6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};">${value}</td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table>`;
}

/** Warning (amber). */
const notice = (html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;border-collapse:separate;"><tr><td style="padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;font-family:${FONT};font-size:13px;line-height:20px;color:#92400e;">${html}</td></tr></table>`;

interface Layout {
  t: ServerTranslator;
  locale: AppLocale;
  options: EmailRenderOptions;
  /** Raw (escaped here). */
  appTitle: string;
  /** Raw (escaped here); empty: neither links nor logo. */
  baseUrl: string;
  /** Short label at the top right, plain text. */
  badge: string;
  /** The label and its dot in red (deletion). */
  danger?: boolean;
  /** Heading, plain text. */
  heading: string;
  /** Line above the heading ("Bonjour Jean,"), HTML (escaped). */
  greeting?: string;
  /** Preview line shown by the mail clients after the subject, HTML (escaped). */
  preheader: string;
  /** Body, HTML. */
  body: string;
  /** Main button (raw address and label). */
  button?: { href: string; label: string } | null;
  /** Below the button, HTML. */
  after?: string;
}

function layout(l: Layout): string {
  const { t, options } = l;
  const theme = themeOf(options);
  const logo = options.brand?.logo ?? null;
  const appTitle = escapeHtml(l.appTitle);
  const base = l.baseUrl.trim().replace(/\/+$/, "");
  const home = escapeHtml(base);
  const host = escapeHtml(base.replace(/^https?:\/\//, ""));
  const badgeColor = l.danger ? C.danger : theme.accentText;
  const dotColor = l.danger ? C.danger : theme.accent;

  // The name of the application stands for the logo when the image is not loaded (alt text, same style)
  const mark = logo
    ? `<img src="${escapeHtml(logo.url)}" width="${logo.width}" height="${logo.height}" alt="${appTitle}" style="display:block;border:0;outline:none;width:${logo.width}px;height:${logo.height}px;font-family:${FONT};font-size:18px;font-weight:700;color:${C.text};">`
    : `<span style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:${C.text};">${appTitle}</span>`;
  const brand = home ? `<a href="${home}" style="text-decoration:none;">${mark}</a>` : mark;

  const button = l.button
    ? `<tr><td class="px" style="padding:28px 40px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="${theme.accent}" style="border-radius:999px;background:${theme.accent};">
            <a href="${escapeHtml(l.button.href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${theme.onAccent};text-decoration:none;border-radius:999px;">${escapeHtml(l.button.label)}&nbsp;&nbsp;&rarr;</a>
          </td>
        </tr></table>
      </td></tr>`
    : "";

  const automatic = t("emails.layout.automatic", { appTitle: l.appTitle, date: formatDateTime(new Date(), l.locale, options.dates) });

  // i18n-ignore HTML template: texts go through t()
  return `<!DOCTYPE html>
<html lang="${l.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(l.heading)}</title>
<style>
  body { margin: 0; padding: 0; background: ${C.page}; -webkit-text-size-adjust: 100%; }
  @media (max-width: 620px) {
    .wrap { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .h1 { font-size: 22px !important; line-height: 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${l.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
  <tr>
    <td align="center" style="padding:32px 12px 40px;">
      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:600px;background:${C.card};border:1px solid ${C.line};border-radius:20px;border-collapse:separate;">

        <tr><td class="px" style="padding:32px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle">${brand}</td>
            <td valign="middle" align="right" style="${labelStyle(badgeColor)}white-space:nowrap;"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${dotColor};vertical-align:middle;margin:-2px 8px 0 0;"></span>${escapeHtml(l.badge)}</td>
          </tr></table>
        </td></tr>

        <tr><td class="px" style="padding:24px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="56" height="2" bgcolor="${theme.accent}" style="width:56px;height:2px;line-height:2px;font-size:0;background:${theme.accent};">&nbsp;</td>
            <td height="2" bgcolor="${C.line}" style="height:2px;line-height:2px;font-size:0;background:${C.line};">&nbsp;</td>
          </tr></table>
        </td></tr>

        <tr><td class="px" style="padding:30px 40px 0;">
          ${l.greeting ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">${l.greeting}</p>` : ""}
          <h1 class="h1" style="margin:0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.4px;color:${C.text};">${escapeHtml(l.heading)}</h1>
        </td></tr>

        <tr><td class="px" style="padding:16px 40px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};">
          ${l.body}
        </td></tr>
${button}
        ${l.after ? `<tr><td class="px" style="padding:22px 40px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${l.after}</td></tr>` : ""}

        <tr><td class="px" style="padding:36px 40px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${C.line}" style="height:1px;line-height:1px;font-size:0;background:${C.line};">&nbsp;</td></tr></table>
          <p style="margin:20px 0 2px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${C.text};">${appTitle}</p>
          ${host ? `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;"><a href="${home}" style="color:${theme.accentText};text-decoration:none;">${host}</a></p>` : ""}
          <p style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">${escapeHtml(automatic)}</p>
        </td></tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Address of the planning, for the button of the task e-mails (none without the address of the instance). */
function planningButton(t: ServerTranslator, baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base ? { href: `${base}/planning`, label: t("emails.layout.viewPlanning") } : null;
}

function taskDetails(t: ServerTranslator, task: TaskInfo, project: ProjectInfo | null | undefined, locale: AppLocale, settings: DateSettings, theme: Theme) {
  const dates =
    task.endDate && task.endDate !== task.startDate
      ? `${formatDate(task.startDate, locale, settings.dateFormat)} → ${formatDate(task.endDate, locale, settings.dateFormat)}`
      : formatDate(task.startDate, locale, settings.dateFormat);

  const times =
    task.startTime && task.endTime ? ` (${formatTime(task.startTime, locale, settings.timeFormat)} – ${formatTime(task.endTime, locale, settings.timeFormat)})` : "";

  const items: [string, string][] = [];
  if (project) {
    items.push([
      t("emails.task.project"),
      `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${safeCssColor(project.color)};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(project.name)}`,
    ]);
  }
  items.push([t("emails.task.dates"), escapeHtml(dates + times)]);
  if (task.notes) items.push([t("emails.task.notes"), escapeHtmlMultiline(task.notes)]);
  return box(rows(items), theme, undefined, C.soft);
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
  const params = { actor: escapeHtml(creatorName), title: escapeHtml(task.title) };
  const intro = t.markup("emails.taskCreated.intro", { ...params, b: strong });
  return {
    subject: t("emails.taskCreated.subject", { appTitle, title: task.title }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.taskCreated.badge"),
      heading: t("emails.taskCreated.heading"),
      preheader: t.markup("emails.taskCreated.intro", { ...params, b: plain }),
      body: para(intro, "0") + taskDetails(t, task, project, locale, options.dates, themeOf(options)),
      button: planningButton(t, baseUrl),
    }),
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
  const theme = themeOf(options);
  const params = { actor: escapeHtml(modifierName), title: escapeHtml(task.title) };
  const intro = t.markup("emails.taskUpdated.intro", { ...params, b: strong });
  // Numbered, like the steps of a list
  const changeRows = changes
    .map(
      (c, i) => `<tr>
      <td width="32" valign="top" style="width:32px;padding:5px 0;font-family:${MONO};font-size:12px;line-height:20px;color:${theme.accentText};">${String(i + 1).padStart(2, "0")}</td>
      <td valign="top" style="padding:5px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};">${escapeHtml(formatChange(t, c, locale, options.dates))}</td>
    </tr>`,
    )
    .join("");
  const changeList = box(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${changeRows}</table>`,
    theme,
    t("emails.taskUpdated.changesLabel"),
  );
  return {
    subject: t("emails.taskUpdated.subject", { appTitle, title: task.title }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.taskUpdated.badge"),
      heading: t("emails.taskUpdated.heading"),
      preheader: t.markup("emails.taskUpdated.intro", { ...params, b: plain }),
      body: para(intro, "0") + changeList + taskDetails(t, task, project, locale, options.dates, theme),
      button: planningButton(t, baseUrl),
    }),
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
  const params = { actor: escapeHtml(deleterName), title: escapeHtml(task.title) };
  const intro = t.markup("emails.taskDeleted.intro", { ...params, b: strong });
  return {
    subject: t("emails.taskDeleted.subject", { appTitle, title: task.title }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.taskDeleted.badge"),
      danger: true,
      heading: t("emails.taskDeleted.heading"),
      preheader: t.markup("emails.taskDeleted.intro", { ...params, b: plain }),
      body: para(intro, "0") + taskDetails(t, task, project, locale, options.dates, themeOf(options)),
      button: planningButton(t, baseUrl),
    }),
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
  options: EmailRenderOptions,
) {
  const t = getServerTranslatorSync(locale);
  const base = baseUrl.trim().replace(/\/+$/, "");
  const credentials = box(
    rows([
      [t("emails.randomPassword.username"), `<strong style="font-size:15px;color:${C.text};">${escapeHtml(username)}</strong>`],
      [t("emails.randomPassword.password"), `<code style="font-family:${MONO};font-size:15px;font-weight:600;letter-spacing:1px;color:${C.text};">${escapeHtml(password)}</code>`],
    ]),
    themeOf(options),
    undefined,
    C.soft,
  );
  return {
    subject: t("emails.randomPassword.subject", { appTitle }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.randomPassword.badge"),
      greeting: t.markup("emails.common.greeting", { name: escapeHtml(userName), b: strong }),
      heading: t("emails.randomPassword.heading"),
      preheader: escapeHtml(t("emails.randomPassword.intro")),
      body: para(escapeHtml(t("emails.randomPassword.intro")), "0") + credentials + notice(escapeHtml(t("emails.randomPassword.changeNotice"))),
      button: base ? { href: `${base}/login`, label: t("emails.randomPassword.button") } : null,
    }),
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
  options: EmailRenderOptions,
) {
  const t = getServerTranslatorSync(locale);
  const theme = themeOf(options);
  const resetHref = escapeHtml(resetUrl);
  // The link written out, for the mail clients where the button does not work
  const linkBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
      <td style="padding:10px 14px;background:${C.soft};border:1px solid ${C.line};border-radius:10px;word-break:break-all;font-family:${FONT};font-size:12px;line-height:18px;">
        <a href="${resetHref}" style="color:${theme.accentText};text-decoration:underline;">${resetHref}</a>
      </td>
    </tr></table>`;
  const after = [
    para(escapeHtml(t("emails.passwordReset.linkFallback")), "0 0 8px", 13, C.muted),
    linkBox,
    notice(t.markup("emails.passwordReset.expiry", { minutes: expiresMinutes, b: (chunks: string) => `<strong>${chunks}</strong>` })),
    para(escapeHtml(t("emails.passwordReset.ignore")), "18px 0 0", 13, C.muted),
  ].join("");
  return {
    subject: t("emails.passwordReset.subject", { appTitle }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.passwordReset.badge"),
      greeting: t.markup("emails.common.greeting", { name: escapeHtml(userName), b: strong }),
      heading: t("emails.passwordReset.heading"),
      preheader: escapeHtml(t("emails.passwordReset.intro")),
      body: para(escapeHtml(t("emails.passwordReset.intro")), "0"),
      button: { href: resetUrl, label: t("emails.passwordReset.button") },
      after,
    }),
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
  const theme = themeOf(options);
  const startLabel = formatWithLocale(weekStart, "d MMMM", locale);
  const endLabel = formatWithLocale(weekEnd, "d MMMM yyyy", locale);

  const sortedKeys = Array.from(tasksByDay.keys()).sort();

  let dayBlocks = "";
  for (const dayKey of sortedKeys) {
    const dayDate = new Date(dayKey + "T00:00:00");
    const dayLabel = formatWithLocale(dayDate, "EEEE d MMMM yyyy", locale);
    const tasks = tasksByDay.get(dayKey) ?? [];

    let tasksHtml = "";
    if (tasks.length === 0) {
      tasksHtml = para(escapeHtml(t("emails.weeklySummary.noTasks")), "0 0 4px", 13, C.faint);
    } else {
      tasksHtml = tasks.map((task) => {
        const projectColor = safeCssColor(task.project?.color);
        const projectName = escapeHtml(task.project?.name || "—");
        const taskTitle = task.title ? ` — ${escapeHtml(task.title)}` : "";
        const time = task.startTime && task.endTime ? `<span style="color:${C.muted};font-size:12px;margin-left:6px;white-space:nowrap;">${escapeHtml(`${formatTime(task.startTime, locale, options.dates.timeFormat)} – ${formatTime(task.endTime, locale, options.dates.timeFormat)}`)}</span>` : "";
        const address = task.placeText || task.place?.name;
        const addressHtml = address ? `<div style="margin-top:3px;color:${C.body};font-size:12px;line-height:18px;">📍 ${escapeHtml(address)}</div>` : "";
        const fileCount = task.files?.length ?? 0;
        const filesHtml = fileCount > 0 ? `<div style="margin-top:3px;color:${C.body};font-size:12px;line-height:18px;">📎 ${escapeHtml(t("emails.weeklySummary.attachments", { count: fileCount }))}</div>` : ""; // i18n-ignore HTML template

        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-collapse:separate;"><tr>
          <td width="4" bgcolor="${projectColor}" style="width:4px;background:${projectColor};border-radius:4px 0 0 4px;font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding:10px 14px;background:${C.soft};border:1px solid ${C.line};border-left:0;border-radius:0 10px 10px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};">
            <strong>${projectName}</strong>${taskTitle}${time}
            ${addressHtml}
            ${filesHtml}
          </td>
        </tr></table>`;
      }).join("");
    }

    dayBlocks += `<p style="margin:24px 0 10px;${labelStyle(theme.accentText)}">${escapeHtml(dayLabel)}</p>
      ${tasksHtml}`;
  }

  const params = { start: escapeHtml(startLabel), end: escapeHtml(endLabel) };
  const intro = t.markup("emails.weeklySummary.intro", { ...params, b: strong });
  return {
    subject: t("emails.weeklySummary.subject", { appTitle, start: startLabel, end: endLabel }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.weeklySummary.badge"),
      greeting: escapeHtml(t("emails.weeklySummary.greeting", { name: userName })),
      heading: t("emails.weeklySummary.heading"),
      preheader: t.markup("emails.weeklySummary.intro", { ...params, b: plain }),
      body: para(intro, "0") + dayBlocks,
      button: planningButton(t, baseUrl),
    }),
  };
}

export function testEmailTemplate(appTitle: string, locale: AppLocale, options: EmailRenderOptions, baseUrl = "") {
  const t = getServerTranslatorSync(locale);
  const params = { appTitle: escapeHtml(appTitle) };
  const body = t.markup("emails.test.body", { ...params, b: strong });
  return {
    subject: t("emails.test.subject", { appTitle }),
    html: layout({
      t, locale, options, appTitle, baseUrl,
      badge: t("emails.test.badge"),
      heading: t("emails.test.heading"),
      preheader: t.markup("emails.test.body", { ...params, b: plain }),
      body: para(body, "0"),
    }),
  };
}
