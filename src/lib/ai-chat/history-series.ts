/**
 * Cost per day of the AI history chart: the days without any reply are
 * filled with zero, so the axis is continuous. Days are « YYYY-MM-DD » in the
 * instance time zone.
 */
import { localDate } from "./quota";

/** Longest series drawn (ten years): « all the history » stays bounded. */
const MAX_DAYS = 3660;

/** « YYYY-MM-DD » of an instant in the time zone. */
export function localDay(instant: Date, timeZone: string): string {
  const { year, month, day } = localDate(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Every day from `from` to `to` (inclusive), with the cost of `rows` or 0. */
export function fillDailySeries(rows: { day: string; costUsd: number }[], from: string, to: string): { day: string; costUsd: number }[] {
  const byDay = new Map(rows.map((row) => [row.day, row.costUsd]));
  const series: { day: string; costUsd: number }[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && series.length < MAX_DAYS) {
    const day = cursor.toISOString().slice(0, 10);
    series.push({ day, costUsd: byDay.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}
