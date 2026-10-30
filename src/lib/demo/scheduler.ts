import { db } from "@/db";
import { logger } from "@/lib/logger";
import { getInstanceTimezone } from "@/lib/services/config-service";
import { wallClock } from "./clock";
import { getDemoResetTime, isDemoMode } from "./index";
import { resetDemoData } from "./reset";

type SchedulerState = { timer: ReturnType<typeof setInterval>; lastDay: string | null; running: boolean };

// On globalThis: a single scheduler per process, even if the module is loaded twice
const store = globalThis as typeof globalThis & { __hpDemoScheduler?: SchedulerState };

/**
 * Demo reset: once at start, then every day at DEMO_RESET_TIME (instance time
 * zone). Checked every minute against the wall clock, so daylight saving
 * changes and missed runs are handled.
 */
export function startDemoScheduler() {
  if (!isDemoMode() || store.__hpDemoScheduler) return;
  const state: SchedulerState = { timer: setInterval(() => void tick(state), 60_000), lastDay: null, running: false };
  state.timer.unref?.();
  store.__hpDemoScheduler = state;
  void run(state, "startup");
}

async function localNow() {
  return wallClock(new Date(), await getInstanceTimezone());
}

async function tick(state: SchedulerState) {
  const { day, time } = await localNow();
  if (time >= getDemoResetTime() && state.lastDay !== day) await run(state, "nightly");
}

async function run(state: SchedulerState, reason: "startup" | "nightly") {
  if (state.running) return;
  state.running = true;
  try {
    const { day, time } = await localNow();
    // Before the reset time, today's run is still to come
    if (time >= getDemoResetTime()) state.lastDay = day;
    const result = await resetDemoData(db, { today: day });
    if (result.status === "done") {
      // Console, not the in-app log: the logs page is closed in demo mode
      console.log(`[demo] Data reset (${reason}): ${result.users} users, ${result.projects} projects, ${result.tasks} tasks in ${result.ms} ms`);
    } else if (result.status === "refused") {
      logger.error("system", "Demo mode: the database holds data that was not created by the demo, nothing was erased. Use an empty database, or run `humble-planning demo-reset --force` to erase it.", { users: result.users });
    } else {
      logger.warn("system", "Demo reset skipped: another reset is running");
    }
  } catch (err) {
    logger.error("system", "Demo reset failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    state.running = false;
  }
}
