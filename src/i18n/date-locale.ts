import { de, enGB, es, fr, type Locale } from "date-fns/locale";
import type { AppLocale } from "./config";

/**
 * date-fns locales per language. English is en-GB: ISO week (Monday,
 * `firstWeekContainsDate: 4`), like the rest of the application.
 */
export const DATE_FNS_LOCALES = { fr, en: enGB, es, de } satisfies Record<AppLocale, Locale>;

/**
 * "Textual" parts of the time patterns: they follow the language. The
 * 24 h / 12 h choice stays driven by the TIME_FORMAT setting, the date pattern by
 * PLANNING_DATE_FORMAT.
 *  - fr: 14h30, 14h, « 31/12/2026 à 14h30 »
 *  - en: 14:30, 14:00, "31/12/2026, 14:30"
 *  - es: 14:30, 14:00, "31/12/2026, 14:30" (hour without leading zero: 8:30)
 *  - de: 14:30, 14:00, "31.12.2026, 14:30"
 */
export const TIME_STYLE: Record<AppLocale, { h24: string; hourOnly24: string; dateTimeJoin: string }> = {
  fr: { h24: "H'h'mm", hourOnly24: "H'h'", dateTimeJoin: " 'à' " },
  en: { h24: "HH:mm", hourOnly24: "HH':00'", dateTimeJoin: ", " },
  es: { h24: "H:mm", hourOnly24: "H':00'", dateTimeJoin: ", " },
  de: { h24: "HH:mm", hourOnly24: "HH':00'", dateTimeJoin: ", " },
};

/**
 * "Textual" patterns written in French order ("d MMMM yyyy", "EEEE d MMMM"…),
 * rewritten for languages whose order or punctuation differs:
 *  - de: "Montag, 2. November 2026", "2. Nov."
 *  - es: "lunes, 2 de noviembre de 2026", "2 nov"
 * Numeric patterns (dd/MM/yyyy…) and English (en-GB) stay as is.
 */
const TEXT_DATE_PATTERNS: Partial<Record<AppLocale, Record<string, string>>> = {
  de: {
    "EEEE d MMMM yyyy": "EEEE, d. MMMM yyyy",
    "EEEE d MMMM": "EEEE, d. MMMM",
    "EEE d MMM": "EEE, d. MMM",
    "d MMMM yyyy": "d. MMMM yyyy",
    "d MMM yyyy": "d. MMM yyyy",
    "d MMMM": "d. MMMM",
    "d MMM": "d. MMM",
  },
  es: {
    "EEEE d MMMM yyyy": "EEEE, d 'de' MMMM 'de' yyyy",
    "EEEE d MMMM": "EEEE, d 'de' MMMM",
    "EEE d MMM": "EEE, d MMM",
    "d MMMM yyyy": "d 'de' MMMM 'de' yyyy",
    "d MMMM": "d 'de' MMMM",
  },
};

/** date-fns pattern adapted to the language (`locale`: language code, or date-fns `Locale.code`). */
export function localizeDatePattern(pattern: string, locale: string | undefined): string {
  return TEXT_DATE_PATTERNS[(locale ?? "").slice(0, 2) as AppLocale]?.[pattern] ?? pattern;
}

export function getDateFnsLocale(locale: AppLocale): Locale {
  return DATE_FNS_LOCALES[locale] ?? fr;
}
