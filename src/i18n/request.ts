import { getRequestConfig } from "next-intl/server";
import { IntlErrorCode } from "next-intl";
import { isLocale } from "./config";
import { resolveRequestLocale } from "./resolve-locale";
import { loadMessages } from "./messages";
import { logger } from "@/lib/logger";

/**
 * Per-request next-intl configuration (Server Components: `getTranslations`,
 * `useTranslations` in a non-async server component, `getLocale`…).
 * Cached per request by next-intl.
 *
 * No locale routing: the language comes from the `HP_LOCALE` cookie, the
 * `APP_LOCALE` setting, then `Accept-Language` (see `resolve-locale.ts`). The
 * `cookies()` call makes every page dynamic.
 */
export default getRequestConfig(async ({ locale: override }) => {
  // `override`: explicit locale passed to getTranslations({ locale })
  const locale = isLocale(override) ? override : await resolveRequestLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    // timeZone deliberately omitted: dates go through src/lib/utils/dates.ts
    // (PLANNING_DATE_FORMAT / TIME_FORMAT / TIMEZONE settings), never format.dateTime.
    onError(error) {
      // ENVIRONMENT_FALLBACK = "no timeZone": intended (dates outside next-intl), ignored.
      if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK) return;
      if (error.code === IntlErrorCode.MISSING_MESSAGE) logger.warn("system", `[i18n] ${error.message}`);
      else logger.error("system", `[i18n] ${error.message}`);
    },
    getMessageFallback({ namespace, key }) {
      const path = [namespace, key].filter(Boolean).join(".");
      return process.env.NODE_ENV === "production" ? path : `⟦${path}⟧`;
    },
  };
});
