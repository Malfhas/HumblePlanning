/**
 * Monthly AI chat quota: the part computable without database or clock.
 *
 * The quota is measured in real money (sum of the costs returned by
 * OpenRouter on the user's replies), over a period that restarts every month
 * on the configured day, at midnight in the instance time zone. A manual
 * reset, global or account-specific, moves the period start forward without
 * changing the date of the next reset: that one stays the next occurrence of
 * the configured day. Everything here is deterministic and receives the
 * current instant (and the time zone) as a parameter, so it can be tested
 * without waiting for the first of the month.
 */
import { AppError } from "@/lib/errors";
import { FALLBACK_LOCALE, INTL_TAG, type AppLocale } from "@/i18n/config";

/** Default time zone, the one of the original project: the ported tests rely on it. */
export const DEFAULT_TIMEZONE = "Europe/Paris";

/** Year, month (1 to 12) and day of an instant, read in the given time zone. */
function localDate(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  // « en-CA » writes YYYY-MM-DD: the only locale that splits without surprises
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(instant)
    .split("-")
    .map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Offset of the time zone from UTC at this instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000;
}

/**
 * Midnight of a given day in the time zone, as a UTC instant. The month may
 * overflow (0 = December of the previous year, 13 = January of the next one):
 * `Date.UTC` carries it over. Two passes for the offset: the one read on the
 * UTC approximation may differ from the one of the real local midnight around
 * a DST change.
 */
export function localMidnight(year: number, month: number, day: number, timeZone = DEFAULT_TIMEZONE): Date {
  const approximation = Date.UTC(year, month - 1, day);
  const firstPass = approximation - offsetMs(new Date(approximation), timeZone);
  return new Date(approximation - offsetMs(new Date(firstPass), timeZone));
}

/**
 * Start of the current period: the most recent of three dates, the last
 * occurrence of the configured day (the previous month's if the day has not
 * yet passed this month), the global reset and the account-specific one.
 */
export function periodStart(params: {
  now: Date;
  /** Configured day of the month, from 1 to 28. */
  day: number;
  resetAt: Date | null;
  userResetAt: Date | null;
  timeZone?: string;
}): Date {
  const timeZone = params.timeZone ?? DEFAULT_TIMEZONE;
  const { year, month, day: today } = localDate(params.now, timeZone);
  const lastOccurrence =
    today >= params.day
      ? localMidnight(year, month, params.day, timeZone)
      : localMidnight(year, month - 1, params.day, timeZone);
  const candidates = [lastOccurrence, params.resetAt, params.userResetAt]
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());
  return new Date(Math.max(...candidates));
}

/** Next occurrence of the configured day, at midnight in the time zone. */
export function nextReset(now: Date, day: number, timeZone = DEFAULT_TIMEZONE): Date {
  const { year, month, day: today } = localDate(now, timeZone);
  // On the day itself, the reset already happened at midnight: the next one is in a month
  return today >= day
    ? localMidnight(year, month + 1, day, timeZone)
    : localMidnight(year, month, day, timeZone);
}

/** « 01/09/2026 »: the date as the user reads it, in their language. */
export function formatQuotaDate(date: Date, timeZone = DEFAULT_TIMEZONE, locale: AppLocale = FALLBACK_LOCALE): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: "short", timeZone }).format(date);
}

/**
 * Share of the quota used, as an integer from 0 to 100. Rounded down: 100 is
 * only shown when the amount is really reached, which keeps the gauge in line
 * with the refusal. Without an amount, nothing to measure.
 */
export function quotaPercentage(usageUsd: number, amountUsd: number): number {
  if (amountUsd <= 0) return 0;
  return Math.min(100, Math.floor((usageUsd / amountUsd) * 100));
}

/**
 * The refusal (403), with the next reset date already formatted in the
 * user's language: `handleApiError` translates the code.
 */
export function quotaReachedError(next: Date, timeZone = DEFAULT_TIMEZONE, locale: AppLocale = FALLBACK_LOCALE): AppError {
  return new AppError("aiChat.errors.quotaReached", { status: 403, params: { date: formatQuotaDate(next, timeZone, locale) } });
}

/**
 * How far a retention purge could erase the ledger: the retention limit,
 * without ever cutting into the current period.
 */
export function ledgerPurgeThreshold(limit: Date, globalPeriodStart: Date): Date {
  return limit < globalPeriodStart ? limit : globalPeriodStart;
}
