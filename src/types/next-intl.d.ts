import type { AppLocale } from "@/i18n/config";
import type { Messages } from "@/messages/fr";

/**
 * Strict next-intl typing: the keys of `useTranslations` / `getTranslations`
 * / `createTranslator` are checked against the French catalog (reference).
 * Dynamic keys: `tDyn()` (src/i18n/dynamic.ts).
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
