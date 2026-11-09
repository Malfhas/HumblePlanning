/**
 * Nightly purge (03:00, instance time zone): AI history and quota ledger
 * (CHAT_HISTORY_RETENTION, never the current quota period), system events and
 * old task runs (SYSTEM_EVENTS_RETENTION). Each run is recorded in
 * `system_task_runs`. Started once per process by src/instrumentation.ts.
 */
import { logger } from "@/lib/logger";
import { getConfigValues, getInstanceTimezone } from "./config-service";
import { purgeAiHistory } from "./ai-history-service";
import { purgeSystemEventsBefore } from "./system-event-service";
import { closeInterruptedTaskRuns, purgeTaskRunsBefore, recordTaskRun } from "./system-task-service";
import {
  DAILY_PURGE_HOUR,
  DEFAULT_CHAT_HISTORY_RETENTION_DAYS,
  DEFAULT_SYSTEM_EVENTS_RETENTION_DAYS,
  nextDailyRun,
  parseRetentionDays,
  retentionCutoff,
} from "@/lib/system-health/retention";
import { setNextRun } from "@/lib/system-health/next-runs";

/** Retention settings in days (0 = never), with the defaults of instances that predate them. */
export async function getRetentionSettings() {
  const config = await getConfigValues(["CHAT_HISTORY_RETENTION", "SYSTEM_EVENTS_RETENTION"]);
  return {
    chatHistoryDays: parseRetentionDays(config.CHAT_HISTORY_RETENTION, DEFAULT_CHAT_HISTORY_RETENTION_DAYS),
    systemEventsDays: parseRetentionDays(config.SYSTEM_EVENTS_RETENTION, DEFAULT_SYSTEM_EVENTS_RETENTION_DAYS),
  };
}

export async function runDailyPurge(now = new Date()) {
  const { chatHistoryDays, systemEventsDays } = await getRetentionSettings();
  const chatCutoff = retentionCutoff(now, chatHistoryDays);
  const eventsCutoff = retentionCutoff(now, systemEventsDays);
  const aiHistory = chatCutoff ? await purgeAiHistory(chatCutoff) : null;
  const systemEvents = eventsCutoff ? await purgeSystemEventsBefore(eventsCutoff) : null;
  const taskRuns = eventsCutoff ? await purgeTaskRunsBefore(eventsCutoff) : null;
  await closeInterruptedTaskRuns();
  return { chatHistoryDays, systemEventsDays, aiHistory, systemEvents, taskRuns };
}

type SchedulerState = { started: boolean; timer: ReturnType<typeof setTimeout> | null };
const globalForScheduler = globalThis as unknown as { __hpMaintenanceScheduler?: SchedulerState };
const state: SchedulerState = (globalForScheduler.__hpMaintenanceScheduler ??= { started: false, timer: null });

async function scheduleNext() {
  try {
    const next = nextDailyRun(new Date(), DAILY_PURGE_HOUR, await getInstanceTimezone());
    setNextRun("daily_purge", next);
    state.timer = setTimeout(tick, next.getTime() - Date.now());
  } catch {
    // Configuration not readable yet (database starting): retry in 5 minutes
    state.timer = setTimeout(scheduleNext, 5 * 60_000);
  }
}

async function tick() {
  try {
    await recordTaskRun("daily_purge", () => runDailyPurge(), (result) => ({ detail: result }));
  } catch (error) {
    logger.error("system", "Nightly purge failed", { error: error instanceof Error ? error.message : String(error) }, { error });
  } finally {
    void scheduleNext();
  }
}

/** Arms the nightly purge once per process (the guard is on `globalThis`). */
export function startMaintenanceScheduler() {
  if (state.started) return;
  state.started = true;
  void scheduleNext();
}
