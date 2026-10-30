import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Home, ArrowLeft } from "lucide-react";

/**
 * 404 page — pure Server Component (no "use client"). Next.js 16 evaluates
 * this page at build time during "Collecting page data"; any client hook
 * or lib that assumes a mounted provider (useTheme, useRouter, stateful
 * radix-ui, etc.) would crash with "Cannot read properties of undefined".
 *
 * We deliberately stick to static HTML/CSS. No dynamic logo, no fetch
 * to /api/config/public — the "HumblePlanning" text is enough for an
 * error page. The admin can customize via branding/logo.svg in the root
 * layout if desired. Texts: next-intl (getTranslations, request
 * language), no client hook.
 */
export default async function NotFound() {
  const t = await getTranslations("layout.errorPages.notFound");
  const tc = await getTranslations("common");
  const tNav = await getTranslations("layout.nav");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-primary/[0.03]" />
        <div className="absolute -bottom-32 -left-32 h-[30rem] w-[30rem] rounded-full bg-primary/[0.03]" />
        <div className="absolute top-1/3 left-1/4 h-64 w-64 rounded-full bg-primary/[0.02]" />
      </div>

      <div className="relative w-full max-w-lg text-center space-y-10">
        <div>
          <div className="select-none text-[10rem] font-black leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-muted-foreground/15 to-muted-foreground/5">
            404
          </div>
          <div className="mt-4">
            <p className="text-lg font-semibold text-foreground">{t("title")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("subtitle")}
            </p>
          </div>
        </div>

        <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
          {t("description")}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {tc("actions.back")}
          </Link>
          <Link
            href="/planning"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
          >
            <Home className="h-4 w-4" />
            {tNav("home")}
          </Link>
        </div>
      </div>

      <p className="absolute bottom-6 text-xs text-muted-foreground">
        {t("footer")}
      </p>
    </div>
  );
}
