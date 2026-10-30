import { cookies, headers } from "next/headers";
import { getConfigValue } from "@/lib/services/config-service";
import { APP_LOCALE_CONFIG_KEY, FALLBACK_LOCALE, LOCALE_COOKIE, isLocale, type AppLocale, type LocalePreference } from "./config";
import { pickLocale } from "./accept-language";

/**
 * Server-side language resolution. Never any global state: the language is
 * recomputed for each request (cookie, headers) or for each recipient.
 *
 * - Pages, layouts, API routes: `resolveRequestLocale()`.
 * - Emails, notifications, token-based iCal, MCP, timers (outside a request or for
 *   someone other than the caller): `resolveRecipientLocale(user.locale)`.
 */

/** `APP_LOCALE` admin setting ("auto" by default, and during `next build` without a DB). */
export async function getInstanceLocaleSetting(): Promise<LocalePreference> {
  try {
    const value = await getConfigValue(APP_LOCALE_CONFIG_KEY); // in-memory cache, invalidated by setConfigValue(s)
    return isLocale(value) ? value : "auto";
  } catch {
    return "auto"; // DB unreachable (build)
  }
}

/** Effective language of the current request: cookie → APP_LOCALE → Accept-Language → fr. */
export async function resolveRequestLocale(): Promise<AppLocale> {
  let cookie: string | undefined;
  let acceptLanguage: string | null = null;
  try {
    const [c, h] = await Promise.all([cookies(), headers()]);
    cookie = c.get(LOCALE_COOKIE)?.value;
    acceptLanguage = h.get("accept-language");
  } catch {
    // Called outside a request (timer, script): instance language.
    return resolveRecipientLocale(null);
  }
  return pickLocale({ cookie, instance: await getInstanceLocaleSetting(), acceptLanguage });
}

/** Language the request would have WITHOUT a preference cookie (the selector's "Automatic"). */
export async function resolveAutoLocale(): Promise<AppLocale> {
  let acceptLanguage: string | null = null;
  try {
    acceptLanguage = (await headers()).get("accept-language");
  } catch {
    return resolveRecipientLocale(null);
  }
  return pickLocale({ cookie: null, instance: await getInstanceLocaleSetting(), acceptLanguage });
}

/**
 * Language of a recipient: their last known language (`users.locale`), otherwise
 * the language enforced by the instance, otherwise French. `Accept-Language` makes
 * no sense here (it is not the recipient's browser).
 */
export async function resolveRecipientLocale(userLocale: string | null | undefined): Promise<AppLocale> {
  if (isLocale(userLocale)) return userLocale;
  const instance = await getInstanceLocaleSetting();
  return instance === "auto" ? FALLBACK_LOCALE : instance;
}
