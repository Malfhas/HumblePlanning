import { createTranslator, type IntlError } from "use-intl/core";
import { loadMessages, loadMessagesSync } from "./messages";
import type { AppLocale } from "./config";
import { isMessageKey, type ErrorParams } from "@/lib/errors";
import { logger } from "@/lib/logger";

function logIntlError(error: IntlError) {
  if (error.code === "ENVIRONMENT_FALLBACK") return; // no timeZone: intended
  if (error.code === "MISSING_MESSAGE") logger.warn("system", `[i18n] ${error.message}`);
  else logger.error("system", `[i18n] ${error.message}`);
}
const fallbackPath = ({ namespace, key }: { namespace?: string; key: string }) => [namespace, key].filter(Boolean).join(".");

/**
 * Translator usable ANYWHERE on the server, including outside a request context
 * (notification timers, weekly summary, MCP, Bun scripts).
 *
 * Rule: services and API routes never import `next-intl/server`.
 * They use `getServerTranslator(await resolveRequestLocale())`, or the
 * recipient's language (`resolveRecipientLocale(user.locale)`).
 *
 *   const t = await getServerTranslator(locale);
 *   t("emails.taskCreated.subject", { appTitle, title });
 */
export async function getServerTranslator(locale: AppLocale) {
  const messages = await loadMessages(locale);
  return createTranslator({ locale, messages, onError: logIntlError, getMessageFallback: fallbackPath });
}

export type ServerTranslator = Awaited<ReturnType<typeof getServerTranslator>>;

/**
 * Synchronous variant, for code that must stay synchronous (email
 * templates called by several services): same translator, same rules.
 */
export function getServerTranslatorSync(locale: AppLocale): ServerTranslator {
  return createTranslator({ locale, messages: loadMessagesSync(locale), onError: logIntlError, getMessageFallback: fallbackPath });
}

/**
 * Translates a dynamic key (error code, key stored in the DB) if it exists,
 * otherwise returns `null`. Legacy messages (free French text) are not
 * keys: they pass through unchanged to the caller.
 */
export function translateKey(t: ServerTranslator, key: string, params?: ErrorParams): string | null {
  if (!isMessageKey(key)) return null;
  const untyped = t as unknown as { has(k: string): boolean; (k: string, p?: ErrorParams): string };
  if (!untyped.has(key)) return null;
  return untyped(key, params);
}
