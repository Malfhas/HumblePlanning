"use client";

import { createContext, useContext } from "react";
import { NextIntlClientProvider, IntlErrorCode, type AbstractIntlMessages } from "next-intl";
import type { AppLocale } from "./config";

/**
 * Language the page would have WITHOUT a preference cookie (APP_LOCALE, otherwise
 * Accept-Language): shown by the selector, e.g. « Automatique (Français) ».
 * Computed server-side; the client knows neither APP_LOCALE nor the header.
 */
const AutoLocaleContext = createContext<AppLocale | null>(null);

export function useAutoLocale(): AppLocale | null {
  return useContext(AutoLocaleContext);
}

/**
 * Client provider: rendered by the layouts (Server Components) with the language and
 * messages already resolved server-side. It adds `onError` and
 * `getMessageFallback`, which are not serializable and therefore never inherited.
 *
 * Root: common namespaces + `autoLocale`. Nested in (auth) and
 * (dashboard): their messages REPLACE the parent's (no merge) and
 * `autoLocale`, omitted, stays the root's. Lists: `src/i18n/messages.ts`.
 *
 * The language is NEVER recomputed on the client (navigator.language…): it
 * comes from the server, which guarantees no hydration mismatch.
 */
export function IntlClientProvider({
  locale,
  autoLocale,
  messages,
  children,
}: {
  locale: AppLocale;
  autoLocale?: AppLocale;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={(error) => {
        // ENVIRONMENT_FALLBACK = "no timeZone": intended (dates go through
        // src/lib/utils/dates.ts, never useFormatter().dateTime), ignored.
        if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK) return;
        if (error.code !== IntlErrorCode.MISSING_MESSAGE) console.error(error);
        else if (process.env.NODE_ENV !== "production") console.warn(error.message);
      }}
      getMessageFallback={({ namespace, key }) => {
        const path = [namespace, key].filter(Boolean).join(".");
        return process.env.NODE_ENV === "production" ? path : `⟦${path}⟧`;
      }}
    >
      {autoLocale ? <AutoLocaleContext.Provider value={autoLocale}>{children}</AutoLocaleContext.Provider> : children}
    </NextIntlClientProvider>
  );
}
