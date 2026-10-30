import {
  addDays,
  eachDayOfInterval,
  format,
  isWeekend,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  differenceInCalendarDays,
  isSameDay,
  parseISO,
  formatDistanceToNow,
} from "date-fns";
import type { Locale } from "date-fns";
import { INTL_TAG, type AppLocale } from "@/i18n/config";
import { getDateFnsLocale, localizeDatePattern, TIME_STYLE } from "@/i18n/date-locale";

/*
 * Dates and times. The formatting functions read NO global state:
 *
 * - the LANGUAGE (day and month names, time separator 14h30 / 14:30) and
 * - the instance SETTINGS (`DateSettings`: PLANNING_DATE_FORMAT pattern,
 *   24 h / 12 h TIME_FORMAT, TIMEZONE)
 *
 * are always passed as parameters. Server: settings read from the DB for each
 * request (`dateSettingsFromConfig`), language of the recipient or the request.
 * Client: `useDateFormat()` (src/hooks/use-date-format.ts) binds these functions
 * to the current language and the settings set by DateFormatProvider.
 */

export function getWorkingDays(start: Date, end: Date, holidays: Set<string> = new Set()): Date[] {
  return eachDayOfInterval({ start, end }).filter(
    (day) => !isWeekend(day) && !holidays.has(format(day, "yyyy-MM-dd"))
  );
}

export function getDateRange(start: Date, end: Date): Date[] {
  return eachDayOfInterval({ start, end });
}

export type TimeFormat = "24h" | "12h";

/** Instance date display settings (the same for all users). */
export interface DateSettings {
  /** date-fns pattern of PLANNING_DATE_FORMAT ("dd/MM/yyyy"…). */
  dateFormat: string;
  /** TIME_FORMAT. */
  timeFormat: TimeFormat;
  /** TIMEZONE: "auto" (browser or server time zone) or an IANA name. */
  timezone: string;
}

export const DEFAULT_DATE_SETTINGS: Readonly<DateSettings> = { dateFormat: "dd/MM/yyyy", timeFormat: "24h", timezone: "auto" };

/** Settings from the configuration values (missing or empty → defaults). */
export function dateSettingsFromConfig(config: {
  PLANNING_DATE_FORMAT?: string | null;
  TIME_FORMAT?: string | null;
  TIMEZONE?: string | null;
}): DateSettings {
  return {
    dateFormat: config.PLANNING_DATE_FORMAT || DEFAULT_DATE_SETTINGS.dateFormat,
    timeFormat: config.TIME_FORMAT === "12h" ? "12h" : "24h",
    timezone: config.TIMEZONE || DEFAULT_DATE_SETTINGS.timezone,
  };
}

/*
 * Browser settings, set once by DateFormatProvider (Client
 * Component, in a useEffect: never during server rendering) and read by
 * useDateFormat(). Server code neither reads nor writes them.
 */
let _clientSettings: DateSettings = { ...DEFAULT_DATE_SETTINGS };

/** Client only (DateFormatProvider). */
export function setDateFormats(dateFormat: string, timeFormat?: TimeFormat) {
  _clientSettings = { ..._clientSettings, dateFormat, ...(timeFormat ? { timeFormat } : {}) };
}

/** Client only (DateFormatProvider). */
export function setTimezone(tz: string) {
  _clientSettings = { ..._clientSettings, timezone: tz || "auto" };
}

/** Client only: settings set by DateFormatProvider (defaults before the configuration loads). */
export function getClientDateSettings(): DateSettings {
  return _clientSettings;
}

/**
 * Date + time pattern for a language. 12 h: the same in every language;
 * 24 h: joiner and separator specific to the language (fr « 31/12/2026 à 14h30 »,
 * en "31/12/2026, 14:30"). The date pattern stays the configured one.
 */
function buildDateTimeFormat(dateFormat: string, timeFormat: TimeFormat, locale: AppLocale): string {
  if (timeFormat === "12h") return `${dateFormat} hh:mm a`;
  if (locale === "fr") return `${dateFormat} 'à' HH'h'mm`; // i18n-ignore French-specific date-fns pattern (2-digit hour, legacy)
  const style = TIME_STYLE[locale];
  return `${dateFormat}${style.dateTimeJoin}${style.h24}`;
}

/**
 * "HH:mm[:ss]" time for display, according to TIME_FORMAT (`timeFormat`).
 * 24 h: fr « 14h30 » / « 14h », en "14:30" / "14:00". 12 h: "2:30 PM".
 */
export function formatTime(timeStr: string | null | undefined, locale: AppLocale, timeFormat: TimeFormat): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  if (timeFormat === "12h") {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return m > 0 ? `${h12}:${String(m).padStart(2, "0")} ${period}` : `${h12} ${period}`;
  }
  if (locale === "fr") return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  return `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

/**
 * Whole hour for display (column headers…), according to TIME_FORMAT.
 * 24 h: fr « 14h », en "14:00". 12 h: "2PM".
 */
export function formatHourLabel(hour: number, locale: AppLocale, timeFormat: TimeFormat): string {
  if (timeFormat === "12h") {
    const period = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}${period}`;
  }
  if (locale === "fr") return `${hour}h`;
  return `${String(hour).padStart(2, "0")}:00`;
}

export { getDateFnsLocale };

/**
 * Date in the given language. `fmt`: date-fns pattern, most often the
 * PLANNING_DATE_FORMAT setting (`DateSettings.dateFormat`). Only day and
 * month names change with the language.
 */
export function formatDate(date: Date | string, locale: AppLocale, fmt: string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, localizeDatePattern(fmt, locale), { locale: getDateFnsLocale(locale) });
}

/** date-fns `format` with the language's locale (free pattern: "EEEE d MMMM"…). */
export function formatWithLocale(date: Date, fmt: string, locale: AppLocale): string {
  return format(date, localizeDatePattern(fmt, locale), { locale: getDateFnsLocale(locale) });
}

/** fr « il y a 5 minutes » / en "5 minutes ago". */
export function formatRelative(date: Date | string, locale: AppLocale): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true, locale: getDateFnsLocale(locale) });
}

export type { Locale as DateFnsLocale };

export function isHoliday(date: Date, holidays: Set<string>): boolean {
  return holidays.has(format(date, "yyyy-MM-dd"));
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  };
}

export function getMonthRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
  };
}

export function countWorkingDays(start: Date, end: Date, holidays: Set<string> = new Set()): number {
  return getWorkingDays(start, end, holidays).length;
}

export function addWorkingDays(start: Date, days: number, holidays: Set<string> = new Set()): Date {
  let current = start;
  let remaining = days;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (!isWeekend(current) && !holidays.has(format(current, "yyyy-MM-dd"))) {
      remaining--;
    }
  }
  return current;
}

export function daysBetween(start: Date | string, end: Date | string): number {
  const s = typeof start === "string" ? parseISO(start) : start;
  const e = typeof end === "string" ? parseISO(end) : end;
  return differenceInCalendarDays(e, s) + 1;
}

export function toDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Date + time in the given language, according to the settings (pattern, TIME_FORMAT,
 * TIMEZONE). "auto" time zone: configured pattern, local time zone (fr « 31/12/2026
 * à 14h30 », en "31/12/2026, 14:30"). Fixed time zone: `Intl.DateTimeFormat`.
 */
export function formatDateTime(isoString: string | Date | null | undefined, locale: AppLocale, settings: DateSettings): string {
  if (!isoString) return "";
  const d = typeof isoString === "string" ? parseISO(isoString) : isoString;
  if (!settings.timezone || settings.timezone === "auto") {
    // "auto" — use local timezone (date-fns default behavior)
    return format(d, buildDateTimeFormat(settings.dateFormat, settings.timeFormat, locale), { locale: getDateFnsLocale(locale) });
  }
  // Fixed timezone — use Intl.DateTimeFormat for correct conversion
  const use12h = settings.timeFormat === "12h";
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: settings.timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: use12h,
  }).format(d);
}

/**
 * Get today's date string (YYYY-MM-DD) in the configured timezone.
 * For server-side use — reads TIMEZONE from config.
 */
export function getTodayInTimezone(timezone = "auto"): string {
  // Server-side: "auto" falls back to UTC (no browser available)
  const tz = (!timezone || timezone === "auto") ? "UTC" : timezone;
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Calculate end date from a start date and a number of calendar days.
 * nbDays=1 → endDate=startDate, nbDays=2 → endDate=startDate+1 day, etc.
 * Includes weekends and holidays.
 */
export function calculateEndDateFromDays(startDate: string, nbDays: number): string {
  const start = parseISO(startDate);
  if (nbDays <= 1) return startDate;
  return toDateString(addDays(start, nbDays - 1));
}

/**
 * Calculate the number of calendar days between two dates (inclusive).
 * Same date → 1 day.
 */
export function calculateDaysFromDates(startDate: string, endDate: string): number {
  return differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
}

export { isWeekend, isSameDay, parseISO, addDays, format };
