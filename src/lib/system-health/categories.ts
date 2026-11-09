/**
 * Levels and categories of the application logger (src/lib/logger.ts).
 * Client-safe: the System health page builds its filters from this list.
 */
export const LOG_CATEGORIES = [
  "system", "auth", "api", "socket", "db", "email", "push", "sms",
  "mcp", "backup", "import", "migration", "ai_chat",
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

/** Levels stored in `system_events`; INFO and DEBUG only go to stdout. */
export const STORED_LEVELS = ["ERROR", "WARN"] as const;
export type StoredLevel = (typeof STORED_LEVELS)[number];

/** Background tasks recorded in `system_task_runs`, in display order. */
export const SYSTEM_TASKS = ["daily_purge", "backup", "weekly_summary", "update_check"] as const;
export type SystemTask = (typeof SYSTEM_TASKS)[number];
