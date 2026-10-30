import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { QueryProvider } from "@/components/providers/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DynamicFavicon } from "@/components/layout/dynamic-favicon";
import { MaintenanceBanner } from "@/components/layout/maintenance-banner";
import { MaintenanceGuard } from "@/components/layout/maintenance-guard";
import { SessionGuard } from "@/components/layout/session-guard";
import { DateFormatProvider } from "@/components/providers/date-format-provider";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { DemoBanner } from "@/components/layout/demo-banner";
import { GlobalTaskPreview } from "@/components/layout/global-task-preview";
import { UserThemeSync } from "@/components/layout/user-theme-sync";
import { LocaleSync } from "@/components/layout/locale-sync";
import { AiChatRoot } from "@/components/ai-chat/ai-chat-root";
import { getLocale, getMessages } from "next-intl/server";
import { IntlClientProvider } from "@/i18n/intl-client-provider";
import { pickClientMessages } from "@/i18n/messages";
import type { Messages } from "@/messages/fr";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Full client catalog (the root layout only sends the shared namespaces).
  const [locale, messages] = await Promise.all([
    getLocale(),
    getMessages() as Promise<unknown> as Promise<Messages>,
  ]);
  return (
    <IntlClientProvider locale={locale} messages={pickClientMessages(messages)}>
      <QueryProvider>
        <TooltipProvider delayDuration={300}>
          <MaintenanceGuard>
            <div className="flex h-screen overflow-hidden">
              <Sidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <DemoBanner />
                <Header />
                <DynamicFavicon />
                <main className="flex-1 overflow-auto p-3 md:p-6">{children}</main>
              </div>
            </div>
          </MaintenanceGuard>
          <MaintenanceBanner />
          <AnnouncementBanner />
          <SessionGuard />
          <DateFormatProvider />
          <GlobalTaskPreview />
          <UserThemeSync />
          <LocaleSync />
          {/* AI chat: floating orb, toasts and listener; nothing if the chat is unavailable */}
          <AiChatRoot />
        </TooltipProvider>
      </QueryProvider>
    </IntlClientProvider>
  );
}
