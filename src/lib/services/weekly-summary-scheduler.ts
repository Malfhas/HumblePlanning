import { getConfigValue } from "./config-service";
import { runWeeklySummary } from "./weekly-summary-service";
import { logger } from "@/lib/logger";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Compute milliseconds until next run.
 * dayOfWeek: 1 = Monday, 7 = Sunday
 * targetTime: "HH:MM"
 */
function getNextRunDelay(dayOfWeek: number, targetTime: string): number {
  const [hours, minutes] = targetTime.split(":").map(Number);
  const now = new Date();

  // JS getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  // We want: 1 = Monday, ..., 7 = Sunday
  const todayIso = now.getDay() === 0 ? 7 : now.getDay();

  let daysUntil = dayOfWeek - todayIso;
  if (daysUntil < 0) daysUntil += 7;

  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(hours, minutes, 0, 0);

  // If the target time today has already passed and daysUntil is 0,
  // schedule for next week
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 7);
  }

  return next.getTime() - now.getTime();
}

async function schedulerTick() {
  try {
    const enabled = await getConfigValue("WEEKLY_SUMMARY_ENABLED");
    if (enabled === "true") {
      await runWeeklySummary();
    }
  } catch (error) {
    logger.error("email", "Weekly summary scheduler error", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleNext();
  }
}

async function scheduleNext() {
  try {
    const enabled = await getConfigValue("WEEKLY_SUMMARY_ENABLED");
    if (enabled !== "true") {
      schedulerTimer = null;
      // Re-check in 1 hour in case admin enables it
      schedulerTimer = setTimeout(scheduleNext, 60 * 60 * 1000);
      return;
    }

    const dayStr = (await getConfigValue("WEEKLY_SUMMARY_DAY")) ?? "1";
    const time = (await getConfigValue("WEEKLY_SUMMARY_TIME")) ?? "08:00";
    const day = parseInt(dayStr, 10) || 1;

    const delay = getNextRunDelay(day, time);
    schedulerTimer = setTimeout(schedulerTick, delay);
    logger.info("email", "Weekly summary scheduled", { day, time, delayMinutes: Math.round(delay / 60000) });
  } catch {
    // Retry in 5 minutes on error
    schedulerTimer = setTimeout(scheduleNext, 5 * 60 * 1000);
  }
}

export function startWeeklySummaryScheduler() {
  if (schedulerTimer) return;
  scheduleNext();
}

export function stopWeeklySummaryScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
