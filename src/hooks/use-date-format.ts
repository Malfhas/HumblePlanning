"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { format } from "date-fns";
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatHourLabel,
  formatRelative,
  getClientDateSettings,
} from "@/lib/utils/dates";
import { DATE_FNS_LOCALES, localizeDatePattern } from "@/i18n/date-locale";
import { INTL_TAG, type AppLocale } from "@/i18n/config";

/**
 * Date functions bound to the current language (client).
 *
 *   const { formatDate, formatDateTime, formatTime, dateLocale, format } = useDateFormat();
 *   formatDate(task.startDate)            // PLANNING_DATE_FORMAT pattern
 *   format(day, "EEEE d MMMM")            // free pattern, names in the language
 *   <Calendar … />                        // the locale is already applied by Calendar
 *   <DayPicker locale={dateLocale} />     // third-party components
 *
 * Does not depend on `useConfig`: also works on the authentication pages
 * (no QueryProvider). The settings (pattern, 24 h / 12 h, time zone) are the ones set
 * by DateFormatProvider, read on every call.
 */
export function useDateFormat() {
  const locale = useLocale() as AppLocale;
  return useMemo(
    () => ({
      locale,
      intlTag: INTL_TAG[locale],
      dateLocale: DATE_FNS_LOCALES[locale],
      formatDate: (d: Date | string, fmt?: string) => formatDate(d, locale, fmt ?? getClientDateSettings().dateFormat),
      formatDateTime: (d: Date | string | null | undefined) => formatDateTime(d, locale, getClientDateSettings()),
      formatTime: (t: string | null | undefined) => formatTime(t, locale, getClientDateSettings().timeFormat),
      formatHourLabel: (h: number) => formatHourLabel(h, locale, getClientDateSettings().timeFormat),
      formatRelative: (d: Date | string) => formatRelative(d, locale),
      format: (d: Date, fmt: string) => format(d, localizeDatePattern(fmt, locale), { locale: DATE_FNS_LOCALES[locale] }),
      formatNumber: (n: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(INTL_TAG[locale], options).format(n),
    }),
    [locale],
  );
}
