import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarSpan } from "@/lib/types/planning";
import { calculateTaskHoursInPeriod } from "./hours";

/**
 * Pure helpers of the calendar view (`/planning`, "Calendar" tab): visible
 * window, navigation, bars spanning several days and daily load.
 * The anchor is the planning store `startDate`.
 */

/** Periods offered by the calendar view, in toolbar order. */
export const CALENDAR_SPANS: readonly CalendarSpan[] = [1, 3, 5, 7, "month"];

export function isCalendarSpan(value: unknown): value is CalendarSpan {
  return CALENDAR_SPANS.includes(value as CalendarSpan);
}

/** Reads a stored span ("1" … "7", "month"); `null` when unknown. */
export function parseCalendarSpan(raw: string | null | undefined): CalendarSpan | null {
  if (raw === "month") return "month";
  const n = Number(raw);
  return isCalendarSpan(n) ? n : null;
}

/** Weeks start on Monday in every language of the application (ISO weeks). */
const WEEK = { weekStartsOn: 1 } as const;

/**
 * First and last day shown for an anchor: `span` days from it, or the whole
 * weeks (Monday → Sunday) covering its month.
 */
export function calendarWindow(anchor: Date, span: CalendarSpan): { start: Date; end: Date } {
  if (span === "month") {
    return {
      start: startOfWeek(startOfMonth(anchor), WEEK),
      end: startOfDay(endOfWeek(endOfMonth(anchor), WEEK)),
    };
  }
  const start = startOfDay(anchor);
  return { start, end: addDays(start, span - 1) };
}

/** Every day from `start` to `end`, both included. */
export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Number of days of [start, end], both included (at least 1). */
export function rangeLength(start: Date, end: Date): number {
  return Math.max(1, differenceInCalendarDays(end, start) + 1);
}

/** Anchor that shows `day`: the day itself, or the first day of its month. */
export function anchorFor(day: Date, span: CalendarSpan): Date {
  return span === "month" ? startOfMonth(day) : startOfDay(day);
}

/** Anchor one period earlier or later: `span` days, or the first day of the previous / next month. */
export function shiftCalendarAnchor(anchor: Date, span: CalendarSpan, direction: 1 | -1): Date {
  if (span === "month") return startOfMonth(addMonths(startOfMonth(anchor), direction));
  return addDays(startOfDay(anchor), direction * span);
}

export interface DatedTask {
  id: string;
  startDate: string;
  endDate?: string | null;
}

export interface CalendarBar<T> {
  task: T;
  /** Index of the first visible day covered (0-based). */
  start: number;
  /** Number of visible days covered. */
  length: number;
  /** Line of the bar (0 = top). */
  lane: number;
  /** The task starts before the first visible day. */
  clippedStart: boolean;
  /** The task ends after the last visible day. */
  clippedEnd: boolean;
}

/**
 * Lays out tasks as horizontal bars over consecutive days (`yyyy-MM-dd`): a week
 * of the month grid, or the "all day" band of the hours view. Each task takes the
 * first line free over its days; earlier, then longer tasks first (stable for
 * ties, so the caller's order is kept).
 */
export function layoutBars<T extends DatedTask>(
  days: string[],
  tasks: T[],
): { bars: CalendarBar<T>[]; laneCount: number } {
  if (days.length === 0) return { bars: [], laneCount: 0 };
  const first = days[0];
  const last = days[days.length - 1];
  const index = new Map(days.map((d, i) => [d, i]));

  const segments: Omit<CalendarBar<T>, "lane">[] = [];
  for (const task of tasks) {
    const end = task.endDate || task.startDate;
    if (end < first || task.startDate > last) continue;
    const start = task.startDate < first ? 0 : index.get(task.startDate);
    const stop = end > last ? days.length - 1 : index.get(end);
    if (start === undefined || stop === undefined || stop < start) continue;
    segments.push({
      task,
      start,
      length: stop - start + 1,
      clippedStart: task.startDate < first,
      clippedEnd: end > last,
    });
  }
  segments.sort((a, b) => a.start - b.start || b.length - a.length);

  const laneEnds: number[] = [];
  const bars = segments.map((segment) => {
    let lane = laneEnds.findIndex((endIndex) => endIndex < segment.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }
    laneEnds[lane] = segment.start + segment.length - 1;
    return { ...segment, lane };
  });
  return { bars, laneCount: laneEnds.length };
}

/** Planned work of a day compared with the configured working day. */
export type DayLoad = "empty" | "partial" | "full" | "over";

type HourTask = Parameters<typeof calculateTaskHoursInPeriod>[0];

/** "07:30" → 7.5 (setting DURATION_DAY, same default as the exports and statistics). */
export function parseDailyHours(raw: string | null | undefined): number {
  const [h, m] = (raw || "07:30").split(":").map(Number);
  const hours = (h || 0) + (m || 0) / 60;
  return hours > 0 ? hours : 7.5;
}

/** Hours planned on `day` (`yyyy-MM-dd`), computed like the exports and statistics. */
export function plannedHoursOn(tasks: HourTask[], day: string, dailyHours: number): number {
  let total = 0;
  for (const task of tasks) total += calculateTaskHoursInPeriod(task, day, day, dailyHours);
  return Math.round(total * 100) / 100;
}

export function dayLoad(hours: number, dailyHours: number): DayLoad {
  if (hours <= 0) return "empty";
  const tolerance = 0.01;
  if (hours > dailyHours + tolerance) return "over";
  if (hours >= dailyHours - tolerance) return "full";
  return "partial";
}

/**
 * Value of the calendar person that shows everyone the signed-in user can pick
 * (planning store `calendarUserId`): never a user id.
 */
export const CALENDAR_EVERYONE = "everyone";

/** A person of a calendar row, `undefined` for "everyone" (no row to assign). */
export function calendarPersonRow(id: string | null | undefined): string | undefined {
  return id && id !== CALENDAR_EVERYONE ? id : undefined;
}

/**
 * Tasks of the calendar over [`first`, `last`] (`yyyy-MM-dd`): those with at
 * least one of `people` among their assignees. A task shared by several of them
 * comes once (first occurrence kept).
 */
export function calendarTasks<T extends DatedTask & { users?: { id: string }[] | null }>(
  tasks: T[],
  people: ReadonlySet<string>,
  first: string,
  last: string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    if (task.startDate > last || (task.endDate || task.startDate) < first) continue;
    if (!task.users?.some((u) => people.has(u.id))) continue;
    seen.add(task.id);
    out.push(task);
  }
  return out;
}

/**
 * Items of a stack limited to `max` places: all of them when they fit,
 * otherwise `max - 1` and the count of the others (shown as "+N").
 */
export function stackOf<T>(items: readonly T[], max: number): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: [...items], more: 0 };
  const shown = items.slice(0, Math.max(max - 1, 0));
  return { shown, more: items.length - shown.length };
}

/** For each of `dayCount` days, the bars on a lane from `visibleLanes` on (hidden). */
export function hiddenBarsPerDay(
  bars: readonly { start: number; length: number; lane: number }[],
  dayCount: number,
  visibleLanes: number,
): number[] {
  const hidden = new Array<number>(dayCount).fill(0);
  for (const bar of bars) {
    if (bar.lane < visibleLanes) continue;
    for (let i = bar.start; i < Math.min(bar.start + bar.length, dayCount); i++) hidden[i]++;
  }
  return hidden;
}

/**
 * People of `people` busy on `day` (`yyyy-MM-dd`): with at least one task that
 * day, each counted once (a task shared by several of them counts for each).
 * The public holidays of the planning grid (`holiday:…` pseudo-tasks) are not tasks.
 */
export function busyPeopleOn(
  tasks: readonly (DatedTask & { users?: { id: string }[] | null })[],
  day: string,
  people: ReadonlySet<string>,
): number {
  const busy = new Set<string>();
  for (const task of tasks) {
    if (task.id.startsWith("holiday:")) continue;
    if (task.startDate > day || (task.endDate || task.startDate) < day) continue;
    for (const user of task.users ?? []) if (people.has(user.id)) busy.add(user.id);
  }
  return busy.size;
}
