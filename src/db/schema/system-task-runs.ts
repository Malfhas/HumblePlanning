import { pgTable, uuid, varchar, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Runs of the background tasks (nightly purge, scheduled backups, weekly
 * summary, update check), shown on the System health page. `success` and
 * `finishedAt` stay null while the run is in progress.
 */
export const systemTaskRuns = pgTable("system_task_runs", {
  id: uuid().primaryKey().defaultRandom(),
  task: varchar("task", { length: 50 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  success: boolean("success"),
  detail: jsonb("detail"),
}, (t) => [
  index("system_task_runs_task_started_idx").on(t.task, t.startedAt),
]);
