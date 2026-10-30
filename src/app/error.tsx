"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Home, RotateCcw } from "lucide-react";

/**
 * 500 page — must be a Client Component (receives `error` + `reset`).
 * Deliberately minimal: no useTheme, no fetch to /api/config/public,
 * no radix-ui component. Same reason as not-found.tsx: Next.js 16
 * evaluates the module server-side at build time and crashes if a
 * client lib assumes a mounted provider. Texts come from next-intl:
 * the root layout (and its provider) wraps this page.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("layout.errorPages");
  const tNav = useTranslations("layout.nav");
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-destructive/[0.03]" />
        <div className="absolute -bottom-32 -left-32 h-[30rem] w-[30rem] rounded-full bg-destructive/[0.03]" />
        <div className="absolute top-1/3 left-1/4 h-64 w-64 rounded-full bg-destructive/[0.02]" />
      </div>

      <div className="relative w-full max-w-lg text-center space-y-10">
        <div>
          <div className="select-none text-[10rem] font-black leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-destructive/15 to-destructive/5">
            500
          </div>
          <div className="mt-4">
            <p className="text-lg font-semibold text-foreground">{t("server.title")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("server.subtitle")}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            {t("server.description")}
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/60 font-mono">
              {t("server.reference", { digest: error.digest })}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            {t("server.retry")}
          </button>
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
        {t("server.footer")}
      </p>
    </div>
  );
}
