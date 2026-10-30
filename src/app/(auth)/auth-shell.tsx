"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

/** Client shell of the authentication pages (background, language, theme, maintenance). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const [configData, setConfigData] = useState<Record<string, string | null>>({});
  const { resolvedTheme } = useTheme();
  const t = useTranslations("layout.maintenance");

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => setConfigData(data))
      .catch(() => {});
  }, []);

  const bgPath = resolveThemedAsset(configData, "LOGIN_BACKGROUND", resolvedTheme);
  const isMaintenanceMode =
    configData.MAINTENANCE_MODE === "true" || configData.MAINTENANCE_MODE === "1";

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted">
      {bgPath && (
        <picture className="absolute inset-0">
          <source
            srcSet={`/api/branding/${bgPath.replace("branding/", "")}`}
            type="image/avif"
          />
          <source
            srcSet={`/api/branding/${bgPath.replace("branding/", "").replace(".avif", ".webp")}`}
            type="image/webp"
          />
          <img
            src={`/api/branding/${bgPath.replace("branding/", "").replace(".avif", ".webp")}`}
            alt=""
            className="h-full w-full object-cover"
          />
        </picture>
      )}
      <div className="relative z-10 w-full flex items-center justify-center px-4 py-8">
        {children}
      </div>
      {/* Language and theme switchers (automatic → light → dark), grouped
          at the bottom right and readable over the background image */}
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
        <LocaleSwitcher
          tooltipSide="top"
          align="end"
          className="rounded-full border bg-background/80 shadow-md backdrop-blur hover:bg-background"
        />
        <ThemeToggle
          tooltipSide="left"
          className="rounded-full border bg-background/80 shadow-md backdrop-blur hover:bg-background"
        />
      </div>
      {isMaintenanceMode && (
        <div className="fixed bottom-4 right-28 z-50 flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg animate-pulse">
          <AlertTriangle className="h-4 w-4" />
          {t("authBadge")}
        </div>
      )}
    </div>
  );
}
