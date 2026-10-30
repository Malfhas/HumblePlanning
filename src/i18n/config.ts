/**
 * Isomorphic i18n configuration (no Next dependency): usable by the
 * server, the client, `proxy.ts`, Bun scripts and tests.
 *
 * Adding a language: copy `src/messages/fr` to `src/messages/<code>`,
 * translate, then add the code to `LOCALES`, a loader in `messages.ts`,
 * the `DATE_FNS_LOCALES` / `TIME_STYLE` entry (`date-locale.ts`), the endonym
 * and the Intl tag below.
 */

export const LOCALES = ["fr", "en", "es", "de"] as const;
export type AppLocale = (typeof LOCALES)[number];
/** Preference: a language, or "automatic" (instance / browser language). */
export type LocalePreference = AppLocale | "auto";

/** Source language (100% of keys) and last resort. */
export const FALLBACK_LOCALE: AppLocale = "fr";

/** Browser preference cookie (missing = "Automatic"). Not HttpOnly: read by the selector. */
export const LOCALE_COOKIE = "HP_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** `app_config` key of the admin setting: "auto" | AppLocale. */
export const APP_LOCALE_CONFIG_KEY = "APP_LOCALE";

/** Endonyms: shown as is, never translated. */
export const LOCALE_NAMES: Record<AppLocale, string> = { fr: "Français", en: "English", es: "Español", de: "Deutsch" };

/** BCP 47 tag for `Intl` (numbers, sorting, `Intl.DisplayNames`, `toLocale*`). */
export const INTL_TAG: Record<AppLocale, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES", de: "de-DE" };

/** Namespaces never sent to the browser (rendered server-side only). */
export const SERVER_ONLY_NAMESPACES = ["emails", "exportFiles", "mcpTools", "seed"] as const;

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || isLocale(value);
}
