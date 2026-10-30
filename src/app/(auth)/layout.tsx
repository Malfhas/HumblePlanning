import { getLocale, getMessages } from "next-intl/server";
import { IntlClientProvider } from "@/i18n/intl-client-provider";
import { AUTH_NAMESPACES, pickClientMessages } from "@/i18n/messages";
import type { Messages } from "@/messages/fr";
import { AuthShell } from "./auth-shell";

/**
 * Authentication pages: only the AUTH_NAMESPACES namespaces are sent
 * to the browser (not the full dashboard catalog).
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([
    getLocale(),
    getMessages() as Promise<unknown> as Promise<Messages>,
  ]);
  return (
    <IntlClientProvider locale={locale} messages={pickClientMessages(messages, AUTH_NAMESPACES)}>
      <AuthShell>{children}</AuthShell>
    </IntlClientProvider>
  );
}
