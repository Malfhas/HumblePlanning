/**
 * GDPR texts entered by the admin (cookie banner, privacy policy)
 * whose default value is translated: `app_config` key → `public` catalog key.
 *
 * Empty value in DB = default text, shown in the reader's language.
 * A value equal to one of the default texts (in any language)
 * is never stored nor returned (`@/lib/services/legal-texts`).
 * Isomorphic module: imported by the Settings page (field placeholder text).
 */
export const LEGAL_TEXT_DEFAULT_KEYS = {
  COOKIE_BANNER_TITLE: "cookies.consent.title",
  COOKIE_BANNER_DESCRIPTION: "cookies.consent.description",
  COOKIE_ANALYTICS_LABEL: "cookies.analytics.title",
  COOKIE_FUNCTIONAL_LABEL: "cookies.functional.title",
  PRIVACY_POLICY_TITLE: "privacy.defaultTitle",
} as const;

export type LegalTextConfigKey = keyof typeof LEGAL_TEXT_DEFAULT_KEYS;
/** Key of the default text in the `public` catalog. */
export type LegalTextMessageKey = (typeof LEGAL_TEXT_DEFAULT_KEYS)[LegalTextConfigKey];

/** Key of the default text (`public` catalog) of a GDPR setting, otherwise `undefined`. */
export function legalTextMessageKey(configKey: string): LegalTextMessageKey | undefined {
  return Object.hasOwn(LEGAL_TEXT_DEFAULT_KEYS, configKey)
    ? LEGAL_TEXT_DEFAULT_KEYS[configKey as LegalTextConfigKey]
    : undefined;
}
