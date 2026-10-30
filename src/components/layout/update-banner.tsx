"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { CircleArrowUp, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import { useUpdateCheck } from "@/hooks/use-update-check";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HREF = "/settings?tab=version";

// ─── Dismissal remembered per version (localStorage, per browser) ────────────

const STORAGE_KEY = "hp:update-banner-dismissed";
const listeners = new Set<() => void>();
/** Fallback when storage is unavailable (private browsing, blocked storage). */
let memoryDismissed: string | null = null;

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryDismissed;
  } catch {
    return memoryDismissed;
  }
}

function dismissVersion(version: string) {
  memoryDismissed = version;
  try {
    window.localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // Hidden for this session only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useDismissedVersion(): string | null {
  return useSyncExternalStore(subscribe, readDismissed, () => null);
}

// ─── Banner ────────────────────────────────────────────────────────────────

/**
 * Notifies users who can edit settings about an update, in the sidebar
 * (above the footer and the version number).
 * Subtle for a regular update, more visible for a security update.
 * Can be dismissed until the next version.
 */
export function UpdateBanner({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const t = useTranslations("version.banner");
  const { can, isLoading } = usePermissions();
  const allowed = !isLoading && can("settings:edit") && can("pages:settings");
  const { data } = useUpdateCheck({ enabled: allowed });
  const dismissed = useDismissedVersion();

  const latest = data?.latest;
  if (!allowed || !data?.updateAvailable || !latest || dismissed === latest.version) return null;

  const security = data.securityUpdate;
  const Icon = security ? ShieldAlert : CircleArrowUp;
  const title = security ? t("security") : t("update");

  if (collapsed) {
    return (
      <div className="flex justify-center pb-1.5" data-testid="update-banner" data-security={security}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={HREF}
              onClick={onNavigate}
              aria-label={t("withVersion", { title, version: latest.version })}
              className={cn(
                "relative flex items-center justify-center rounded-md p-1.5 transition-colors",
                security
                  ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                  : "text-primary hover:bg-sidebar-accent/50",
              )}
            >
              <Icon className="size-4" />
              <span
                className={cn(
                  "absolute right-1 top-1 size-1.5 rounded-full",
                  security ? "bg-red-600 dark:bg-red-400" : "bg-primary",
                )}
              />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{t("withVersion", { title, version: latest.version })}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="px-2 pb-2" data-testid="update-banner" data-security={security}>
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs",
          security
            ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100"
            : "border-border/60 bg-sidebar-accent/40",
        )}
      >
        <Icon
          className={cn("mt-0.5 size-3.5 shrink-0", security ? "text-red-600 dark:text-red-400" : "text-primary")}
        />
        <Link href={HREF} onClick={onNavigate} className="min-w-0 flex-1 hover:underline underline-offset-2">
          <span className="block truncate font-medium">{title}</span>
          <span className={cn("block truncate", security ? "text-red-800/80 dark:text-red-200/80" : "text-muted-foreground")}>
            {t("details", { version: latest.version })}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => dismissVersion(latest.version)}
          aria-label={t("dismiss")}
          title={t("dismiss")}
          className={cn(
            "-mr-1 -mt-0.5 shrink-0 rounded p-0.5 transition-colors",
            security
              ? "text-red-700/70 hover:bg-red-100 hover:text-red-900 dark:text-red-300/70 dark:hover:bg-red-900/50 dark:hover:text-red-100"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
