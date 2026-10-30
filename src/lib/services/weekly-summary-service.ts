import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { addDays, format, nextMonday, startOfDay } from "date-fns";
import { getConfigValues, getConfigValue } from "./config-service";
import { getTasks } from "./task-service";
import { sendEmail } from "./email-service";
import { weeklySummaryTemplate } from "./email-templates";
import { logger } from "@/lib/logger";
import { dateSettingsFromConfig, formatWithLocale } from "@/lib/utils/dates";
import { resolveRecipientLocale } from "@/i18n/resolve-locale";
import type { AppLocale } from "@/i18n/config";

/**
 * Compute the next week window: Monday → Sunday of the upcoming week.
 * If today is Monday, returns next Monday → Sunday (not the current week).
 */
export function getNextWeekRange(): { start: Date; end: Date } {
  const today = startOfDay(new Date());
  // nextMonday returns the next Monday strictly after the given date
  const start = nextMonday(today);
  const end = addDays(start, 6);
  return { start, end };
}

/**
 * Send a weekly summary email to a single user.
 * Returns true if an email was sent, false if no tasks (no email sent).
 */
export async function sendWeeklySummaryForUser(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user || !user.email) return false;

  const { start, end } = getNextWeekRange();
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  const result = await getTasks({
    userId,
    startDate: startStr,
    endDate: endStr,
    page: 1,
    limit: 500,
  });

  if (result.data.length === 0) {
    logger.info("email", "Weekly summary skipped (no tasks)", { userId, start: startStr, end: endStr });
    return false;
  }

  // Group tasks by date string (yyyy-MM-dd)
  const tasksByDay = new Map<string, typeof result.data>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const key = format(day, "yyyy-MM-dd");
    tasksByDay.set(key, []);
  }
  for (const task of result.data) {
    // A task may span multiple days — list it on each day it covers within the window
    const taskStart = task.startDate;
    const taskEnd = task.endDate || task.startDate;
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const key = format(day, "yyyy-MM-dd");
      if (key >= taskStart && key <= taskEnd) {
        tasksByDay.get(key)!.push(task);
      }
    }
  }

  const config = await getConfigValues(["APP_TITLE", "APP_BASE_URL", "PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE"]);
  const appTitle = config.APP_TITLE || "HumblePlanning";
  const baseUrl = config.APP_BASE_URL || "";
  const userName = [user.firstName, user.name].filter(Boolean).join(" ") || user.name || "";

  // One language per user: their last known language, otherwise the instance one.
  const locale = await resolveRecipientLocale(user.locale);
  const { subject, html } = weeklySummaryTemplate(userName, tasksByDay, start, end, appTitle, baseUrl, locale, { dates: dateSettingsFromConfig(config) });

  await sendEmail({ to: user.email, subject, html });
  logger.info("email", "Weekly summary sent", { userId, taskCount: result.data.length });
  return true;
}

/**
 * Run the weekly summary for all eligible users.
 * Called by the scheduler.
 */
export async function runWeeklySummary(): Promise<{ sent: number; skipped: number }> {
  const enabled = await getConfigValue("WEEKLY_SUMMARY_ENABLED");
  if (enabled !== "true") {
    logger.info("email", "Weekly summary disabled, skipping run");
    return { sent: 0, skipped: 0 };
  }

  const emailEnabled = await getConfigValue("NOTIFICATION_EMAIL_COCHE");
  if (emailEnabled !== "true") {
    logger.info("email", "Email notifications disabled, skipping weekly summary");
    return { sent: 0, skipped: 0 };
  }

  // Load all users with email + notifications enabled (admin master + user preference)
  const allUsers = await db.query.users.findMany({
    columns: { id: true, name: true, firstName: true, email: true, notifications: true, notificationsUser: true },
  });
  const eligible = allUsers.filter(
    (u) => u.email && u.notifications && u.notificationsUser
  );

  let sent = 0;
  let skipped = 0;

  for (const u of eligible) {
    try {
      const result = await sendWeeklySummaryForUser(u.id);
      if (result) sent++;
      else skipped++;
    } catch (err) {
      logger.error("email", "Weekly summary failed for user", {
        userId: u.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  logger.info("email", `Weekly summary complete`, { sent, skipped, total: eligible.length });
  return { sent, skipped };
}

/**
 * Day label in the given language: « lundi 14 avril 2026 » / « Monday 14 April 2026 ».
 */
export function formatDayLabel(date: Date, locale: AppLocale): string {
  return formatWithLocale(date, "EEEE d MMMM yyyy", locale);
}
