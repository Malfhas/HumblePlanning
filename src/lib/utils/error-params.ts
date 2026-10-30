import type { AppLocale } from "@/i18n/config";
import type { ErrorParams } from "@/lib/errors";
import { DEFAULT_DATE_SETTINGS, formatDate } from "@/lib/utils/dates";

/**
 * Date parameters of an error (`date`, `day`, `*Date`, ISO yyyy-MM-dd):
 * services throw them raw (they don't know the language); they are
 * formatted at translation time, in the reader's language, with the
 * PLANNING_DATE_FORMAT pattern. Same convention as notifications.
 *
 * The configuration is only read if the error carries a date (rare case).
 */
const DATE_PARAM_RE = /(^date$|^day$|Date$)/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function localizeErrorParams(params: ErrorParams | undefined, locale: AppLocale): Promise<ErrorParams | undefined> {
  if (!params) return params;
  const keys = Object.keys(params).filter((k) => {
    const v = params[k];
    return DATE_PARAM_RE.test(k) && typeof v === "string" && ISO_DATE_RE.test(v);
  });
  if (keys.length === 0) return params;
  const { getConfigValue } = await import("@/lib/services/config-service");
  const pattern = (await getConfigValue("PLANNING_DATE_FORMAT")) || DEFAULT_DATE_SETTINGS.dateFormat;
  return { ...params, ...Object.fromEntries(keys.map((k) => [k, formatDate(String(params[k]), locale, pattern)])) };
}
