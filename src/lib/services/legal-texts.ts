import { LOCALES } from "@/i18n/config";
import { getServerTranslatorSync, translateKey } from "@/i18n/server-translator";
import { LEGAL_TEXT_DEFAULT_KEYS } from "@/lib/constants/legal-text-defaults";

/** Lenient comparison: extra spaces and typographic apostrophes. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[‘’]/g, "'");
}

let defaultsCache: Map<string, Set<string>> | null = null;

/** Default texts of each GDPR setting, in all languages (`public` catalog). */
function getDefaults(): Map<string, Set<string>> {
  if (defaultsCache) return defaultsCache;
  const map = new Map<string, Set<string>>();
  for (const locale of LOCALES) {
    const t = getServerTranslatorSync(locale);
    for (const [configKey, messageKey] of Object.entries(LEGAL_TEXT_DEFAULT_KEYS)) {
      const text = translateKey(t, `public.${messageKey}`);
      if (!text) continue;
      const set = map.get(configKey) ?? new Set<string>();
      set.add(normalize(text));
      map.set(configKey, set);
    }
  }
  defaultsCache = map;
  return map;
}

/**
 * Replaces with `empty` (in place) the GDPR texts equal to their default
 * text, whatever the language of that default:
 * - write (`PUT /api/config`): `""`, nothing is saved;
 * - read (`GET /api/config`, `/api/config/public`): empty, the reader sees
 *   the default text in their language (including for old databases where
 *   the French default had been saved on the first save).
 */
export function clearLegalTextDefaults<V extends string | null>(map: Record<string, V>, empty: V): void {
  for (const [key, defaults] of getDefaults()) {
    const value = map[key];
    if (typeof value !== "string" || value === empty) continue;
    const normalized = normalize(value);
    if (normalized === "" || defaults.has(normalized)) {
      map[key] = empty;
    }
  }
}
