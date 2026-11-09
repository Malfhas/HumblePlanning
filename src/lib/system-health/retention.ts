/**
 * Retention of the AI history and of the system events: the part computable
 * without database or clock (everything receives the current instant).
 */
import { localDate, localMidnight } from "@/lib/ai-chat/quota";

/** Days kept by default when the setting is missing (instances older than the setting). */
export const DEFAULT_CHAT_HISTORY_RETENTION_DAYS = 365;
export const DEFAULT_SYSTEM_EVENTS_RETENTION_DAYS = 30;
/** Hour of the nightly purge, in the instance time zone (quiet hours). */
export const DAILY_PURGE_HOUR = 3;

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Retention setting in days: a non-negative integer, 0 = never purge. Anything else: the default. */
export function parseRetentionDays(value: string | null | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 ? days : fallback;
}

/** Instant before which data is purged, or null when the retention is unlimited (0). */
export function retentionCutoff(now: Date, days: number): Date | null {
  return days > 0 ? new Date(now.getTime() - days * DAY_MS) : null;
}

/** Next occurrence of `hour`:00 in the time zone, strictly after `now`. */
export function nextDailyRun(now: Date, hour: number, timeZone: string): Date {
  const { year, month, day } = localDate(now, timeZone);
  for (let offset = 0; ; offset++) {
    const run = new Date(localMidnight(year, month, day + offset, timeZone).getTime() + hour * 3_600_000);
    if (run > now) return run;
  }
}

/**
 * « Before the » date of a manual purge (YYYY-MM-DD): midnight of that day in
 * the instance time zone, so that the chosen day itself is kept. Null when
 * the value is not a real calendar date.
 */
export function purgeBeforeInstant(date: string, timeZone: string): Date | null {
  const match = ISO_DATE_RE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return localMidnight(year, month, day, timeZone);
}

/** Start of a « last N days » filter, or null for « all ». */
export function periodSince(now: Date, days: number | null): Date | null {
  return days && days > 0 ? new Date(now.getTime() - days * DAY_MS) : null;
}
