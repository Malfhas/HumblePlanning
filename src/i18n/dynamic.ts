/**
 * Dynamic keys (`fields.${key}.label`): next-intl's strict typing rejects
 * them. This helper does the cast locally and in a single place.
 *
 * Also declare the prefix in the calling file, so that
 * `bun run i18n:check` does not report these keys as unused:
 *
 *   // i18n-dynamic: settings.fields.*
 *   tDyn(t, `fields.${field.key}.label`)
 */
type AnyTranslator = {
  (key: never, values?: never): string;
  has?: (key: never) => boolean;
};

export function tDyn(t: AnyTranslator, key: string, values?: Record<string, unknown>): string {
  return (t as unknown as (k: string, v?: Record<string, unknown>) => string)(key, values);
}

/** `t.has` for a dynamic key. */
export function hasDyn(t: AnyTranslator, key: string): boolean {
  const has = (t as unknown as { has?: (k: string) => boolean }).has;
  return typeof has === "function" ? has.call(t, key) : false;
}
