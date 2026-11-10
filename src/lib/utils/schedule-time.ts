/**
 * Next runs of the tasks set at a wall-clock time ("02:00") in the instance time zone: the scheduled backups and the
 * weekly summary. Everything receives the current instant and the time zone, so it can be tested.
 */
import { localDate, localTime } from "@/lib/ai-chat/quota";

const HOUR_MS = 3_600_000;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** "HH:MM" as hours and minutes; `fallback` when it is not a time of the day. */
export function parseClockTime(value: string | null | undefined, fallback: { hour: number; minute: number }): { hour: number; minute: number } {
  const match = TIME_RE.exec(value?.trim() ?? "");
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : fallback;
}

/** The time on the local day `offset` days after the one of `now`. */
function onLocalDay(now: Date, offset: number, hour: number, minute: number, timeZone: string): Date {
  const { year, month, day } = localDate(now, timeZone);
  return localTime(year, month, day + offset, hour, minute, timeZone);
}

/**
 * Next scheduled backup, strictly after `now`: the time every day, every week (on the weekday of today), or every
 * 6 or 12 hours counted from that time of today.
 */
export function nextBackupRun(
  now: Date,
  schedule: string,
  time: { hour: number; minute: number },
  timeZone: string,
): Date {
  const today = onLocalDay(now, 0, time.hour, time.minute, timeZone);
  if (schedule === "6h" || schedule === "12h") {
    const step = (schedule === "6h" ? 6 : 12) * HOUR_MS;
    let next = today.getTime();
    // From the time of today, forward (or back, when it is still to come today) to the first step after now
    while (next - step > now.getTime()) next -= step;
    while (next <= now.getTime()) next += step;
    return new Date(next);
  }
  if (today > now) return today;
  return onLocalDay(now, schedule === "weekly" ? 7 : 1, time.hour, time.minute, timeZone);
}

/** Next weekly summary, strictly after `now`: on `isoWeekday` (1 = Monday … 7 = Sunday) at the time. */
export function nextWeeklyRun(
  now: Date,
  isoWeekday: number,
  time: { hour: number; minute: number },
  timeZone: string,
): Date {
  const { year, month, day } = localDate(now, timeZone);
  const todayIso = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  const daysUntil = (((isoWeekday - todayIso) % 7) + 7) % 7;
  const run = onLocalDay(now, daysUntil, time.hour, time.minute, timeZone);
  return run > now ? run : onLocalDay(now, daysUntil + 7, time.hour, time.minute, timeZone);
}
