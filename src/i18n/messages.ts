import frMessages, { type Messages, type Namespace } from "@/messages/fr";
import enMessages from "@/messages/en";
import esMessages from "@/messages/es";
import deMessages from "@/messages/de";
import { FALLBACK_LOCALE, SERVER_ONLY_NAMESPACES, type AppLocale } from "./config";

/**
 * Message catalogs (server only: do not import from a client
 * component, it would get every catalog in its bundle).
 */

// Statically imported catalogs: this module is server only, and the email
// templates need synchronous access (getServerTranslatorSync).
const CATALOGS: Record<AppLocale, Messages> = { fr: frMessages, en: enMessages, es: esMessages, de: deMessages };
const mergedCache = new Map<AppLocale, Messages>();

type Json = { [key: string]: Json | string };

function deepMerge(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key];
    out[key] =
      value && typeof value === "object" && prev && typeof prev === "object"
        ? deepMerge(prev, value)
        : value;
  }
  return out;
}

/**
 * Full catalog of a language. In production, a missing key falls back to
 * French (never a raw key on screen), with the merge cached for the
 * lifetime of the process. In dev, no merge: gaps stay visible (⟦ns.key⟧).
 */
export function loadMessagesSync(locale: AppLocale): Messages {
  if (locale === FALLBACK_LOCALE || process.env.NODE_ENV !== "production") return CATALOGS[locale];
  let merged = mergedCache.get(locale);
  if (!merged) {
    merged = deepMerge(CATALOGS[FALLBACK_LOCALE] as unknown as Json, CATALOGS[locale] as unknown as Json) as unknown as Messages;
    mergedCache.set(locale, merged);
  }
  return merged;
}

/** Async variant (stable API if catalogs go back to being loaded on demand). */
export async function loadMessages(locale: AppLocale): Promise<Messages> {
  return loadMessagesSync(locale);
}

/*
 * Messages sent to the browser, per layout (a nested provider REPLACES those
 * of the parent): root = SHELL_NAMESPACES, (auth) = AUTH_NAMESPACES, (dashboard) =
 * full client catalog. A client component rendered outside the dashboard that uses a
 * new namespace must add it to the relevant list, otherwise it shows the raw key.
 */

/** Root layout: cookie banner, error pages, and the (public) group (/privacy). */
export const SHELL_NAMESPACES = ["common", "layout", "public"] as const satisfies readonly Namespace[];

/** (auth) group: sign-in, passwords, 2FA, MCP authorization. */
export const AUTH_NAMESPACES = [
  ...SHELL_NAMESPACES,
  "auth",
  "errors",
  "mcp",
  "validation",
] as const satisfies readonly Namespace[];

/** Subset sent to the browser: `namespaces` if given, otherwise everything except the server namespaces. */
export function pickClientMessages(messages: Messages, namespaces?: readonly Namespace[]): Partial<Messages> {
  if (namespaces) return Object.fromEntries(namespaces.map((ns) => [ns, messages[ns]]));
  const out: Partial<Messages> = { ...messages };
  for (const ns of SERVER_ONLY_NAMESPACES) delete out[ns];
  return out;
}
