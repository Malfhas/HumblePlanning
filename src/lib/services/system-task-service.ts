/**
 * Runs of the background tasks (System health page): nightly purge, scheduled
 * backups, weekly summary, update check. The bookkeeping never changes the
 * task's outcome: a failed write is reported on stderr and the task goes on.
 */
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemTaskRuns } from "@/db/schema";
import type { SystemTask } from "@/lib/system-health/categories";

type Detail = Record<string, unknown>;

function reportBookkeepingError(err: unknown) {
  console.error("[SYSTEM] Task run not recorded:", err instanceof Error ? err.message : String(err));
}

/** Outcome of a run as recorded: success (default: `fn` resolved) and detail. */
type Describe<T> = (result: T) => { success?: boolean; detail?: Detail | null };

/**
 * Runs `fn` and records the run: start, end, success and detail (`describe`,
 * or the error message when `fn` throws). The result or the error of `fn` is
 * passed through unchanged.
 */
export async function recordTaskRun<T>(task: SystemTask, fn: () => Promise<T>, describe?: Describe<T>): Promise<T> {
  const runId = await db
    .insert(systemTaskRuns)
    .values({ task })
    .returning({ id: systemTaskRuns.id })
    .then(([row]) => row?.id ?? null)
    .catch((err) => {
      reportBookkeepingError(err);
      return null;
    });
  const finish = (success: boolean, detail: Detail | null) =>
    runId
      ? db
          .update(systemTaskRuns)
          .set({ finishedAt: new Date(), success, detail })
          .where(eq(systemTaskRuns.id, runId))
          .catch(reportBookkeepingError)
      : Promise.resolve();
  try {
    const result = await fn();
    const outcome = describe?.(result) ?? {};
    await finish(outcome.success ?? true, outcome.detail ?? null);
    return result;
  } catch (err) {
    await finish(false, { error: (err instanceof Error ? err.message : String(err)).slice(0, 1000) });
    throw err;
  }
}

/** Last run of each task. */
export async function getLastTaskRuns() {
  const rows = await db
    .selectDistinctOn([systemTaskRuns.task])
    .from(systemTaskRuns)
    .orderBy(systemTaskRuns.task, desc(systemTaskRuns.startedAt));
  return new Map(rows.map((row) => [row.task, row]));
}

/** Runs older than `before`, except the last run of each task (always shown). */
export async function purgeTaskRunsBefore(before: Date): Promise<number> {
  const latest = db
    .selectDistinctOn([systemTaskRuns.task], { id: systemTaskRuns.id })
    .from(systemTaskRuns)
    .orderBy(systemTaskRuns.task, desc(systemTaskRuns.startedAt));
  const deleted = await db
    .delete(systemTaskRuns)
    .where(and(lt(systemTaskRuns.startedAt, before), notInArray(systemTaskRuns.id, latest)))
    .returning({ id: systemTaskRuns.id });
  return deleted.length;
}

/** A run still marked in progress by a process that stopped: closed as failed. */
export async function closeInterruptedTaskRuns(): Promise<void> {
  await db
    .update(systemTaskRuns)
    .set({ finishedAt: sql`now()`, success: false, detail: { error: "admin.systemHealth.tasks.interrupted" } })
    .where(sql`${systemTaskRuns.finishedAt} is null and ${systemTaskRuns.startedAt} < now() - interval '1 day'`)
    .catch(reportBookkeepingError);
}
