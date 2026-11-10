import { getConfigValue, getInstanceTimezone } from "./config-service";
import { nextWeeklyRun, parseClockTime } from "@/lib/utils/schedule-time";
import { runWeeklySummary } from "./weekly-summary-service";
import { logger } from "@/lib/logger";
import { recordTaskRun } from "./system-task-service";
import { setNextRun } from "@/lib/system-health/next-runs";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

async function schedulerTick() {
  try {
    const enabled = await getConfigValue("WEEKLY_SUMMARY_ENABLED");
    if (enabled === "true") {
      await recordTaskRun("weekly_summary", () => runWeeklySummary(), (result) => ({ detail: result }));
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
      setNextRun("weekly_summary", null);
      // Re-check in 1 hour in case admin enables it
      schedulerTimer = setTimeout(scheduleNext, 60 * 60 * 1000);
      return;
    }

    const dayStr = (await getConfigValue("WEEKLY_SUMMARY_DAY")) ?? "1";
    const time = (await getConfigValue("WEEKLY_SUMMARY_TIME")) ?? "08:00";
    const day = parseInt(dayStr, 10) || 1;

    // Day and time of the instance time zone, not of UTC
    const next = nextWeeklyRun(new Date(), day, parseClockTime(time, { hour: 8, minute: 0 }), await getInstanceTimezone());
    const delay = Math.max(0, next.getTime() - Date.now());
    schedulerTimer = setTimeout(schedulerTick, delay);
    setNextRun("weekly_summary", next);
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
