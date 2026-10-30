import frErrors from "@/messages/fr/errors.json";
import enErrors from "@/messages/en/errors.json";
import esErrors from "@/messages/es/errors.json";
import deErrors from "@/messages/de/errors.json";
import { FALLBACK_LOCALE, isLocale, type AppLocale } from "./config";

/**
 * Fallback messages for client code that has no access to `useTranslations`
 * (TanStack Query hooks, `fetchApi` functions). Only `errors.json` is imported
 * (a few hundred bytes), never the full catalogs.
 */
const ERRORS: Record<AppLocale, typeof frErrors> = { fr: frErrors, en: enErrors, es: esErrors, de: deErrors };

/** Page language (`<html lang>`, set by the server). */
export function documentLocale(): AppLocale {
  if (typeof document === "undefined") return FALLBACK_LOCALE;
  const lang = document.documentElement.lang?.slice(0, 2);
  return isLocale(lang) ? lang : FALLBACK_LOCALE;
}

export type ClientFallbackKey = "network" | "internal" | "sessionExpired" | "unauthenticated" | "unknown";

/** Generic message in the page language (network, internal, session expired…). */
export function clientFallbackMessage(key: ClientFallbackKey): string {
  return ERRORS[documentLocale()][key];
}

/** Fallback message by HTTP status, when the server returned no usable body. */
export function fallbackMessageForStatus(status: number): string {
  if (status === 401) return clientFallbackMessage("unauthenticated");
  if (status >= 500) return clientFallbackMessage("internal");
  return clientFallbackMessage("network");
}
