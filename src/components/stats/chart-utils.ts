import { parseISO } from "date-fns";
import type { AppLocale } from "@/i18n/config";
import { formatDate, formatWithLocale, getClientDateSettings } from "@/lib/utils/dates";

/**
 * Format a date string for chart axis labels.
 * Handles: "2026-03" (month), "2026-03-28" (day), "2026-W13" (week)
 * Uses the configured date format from settings; month and day names follow
 * `locale` (client: `useDateFormat().locale`).
 */
export function formatChartDate(dateStr: string, locale: AppLocale): string {
  if (!dateStr) return "";

  // Month format: "2026-03"
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr + "-01");
    return formatWithLocale(d, "MMM yyyy", locale);
  }

  // Full date: "2026-03-28"
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const configFmt = getClientDateSettings().dateFormat;
    // For chart axis, use a short version
    const shortFmt = configFmt
      .replace("yyyy", "yy")
      .replace("EEEE ", "")
      .replace("MMMM", "MMM");
    return formatDate(parseISO(dateStr), locale, shortFmt);
  }

  return dateStr;
}
