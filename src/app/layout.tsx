import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Roboto, IBM_Plex_Sans, Source_Sans_3 } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getConfigValue } from "@/lib/services/config-service";
import { CookieConsentBanner } from "@/components/shared/cookie-consent-banner";
import { IntlClientProvider } from "@/i18n/intl-client-provider";
import { pickClientMessages, SHELL_NAMESPACES } from "@/i18n/messages";
import { resolveAutoLocale } from "@/i18n/resolve-locale";
import type { Messages } from "@/messages/fr";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Additional fonts for the planning grid (selectable via /settings).
// `next/font/google` bundles them at build time and serves them from our domain —
// no runtime call to fonts.googleapis.com.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const roboto = Roboto({ variable: "--font-roboto", weight: ["400", "500", "700"], subsets: ["latin"], display: "swap" });
const ibmPlexSans = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap" });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"], display: "swap" });

// Explicit viewport: make sure `width=device-width` is set so that
// `100vw` matches the actual visual width of the screen
// (otherwise iOS Safari may fall back to a default 980 px viewport).
// We keep `userScalable: true` to preserve a11y (manual zoom
// possible). Auto-zoom on input is neutralized via `font-size: 16px`
// in the `<Input>` / `<CommandInput>` components, not via `maximum-scale`.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.meta");
  let title = "HumblePlanning";
  try {
    const dbTitle = await getConfigValue("APP_TITLE");
    if (dbTitle) title = dbTitle;
  } catch {
    // DB not available during build
  }
  return {
    title,
    description: t("description"),
    // Private application: never indexed (see also X-Robots-Tag in next.config.ts and app/robots.ts)
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Language resolved server-side (HP_LOCALE cookie → APP_LOCALE → Accept-Language → fr),
  // passed to the client by the provider: never recomputed in the browser.
  // Messages: shared namespaces only; (auth) and (dashboard) nest their own.
  const [locale, autoLocale, messages] = await Promise.all([
    getLocale(),
    resolveAutoLocale(),
    getMessages() as Promise<unknown> as Promise<Messages>,
  ]);
  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${roboto.variable} ${ibmPlexSans.variable} ${sourceSans.variable} antialiased`}
      >
        <IntlClientProvider locale={locale} autoLocale={autoLocale} messages={pickClientMessages(messages, SHELL_NAMESPACES)}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
            <CookieConsentBanner />
          </ThemeProvider>
        </IntlClientProvider>
      </body>
    </html>
  );
}
