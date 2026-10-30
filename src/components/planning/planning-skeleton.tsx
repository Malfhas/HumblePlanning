"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * PlanningSkeleton — centered animated loader shown during the initial
 * schedule load (rowsQuery, tasksQuery, container measurement).
 *
 * Only fills the schedule content area: the navigation sidebar
 * and the site top bar stay visible around it.
 * Lucide spinner animation + pulsing "Loading the schedule…" label.
 */
export function PlanningSkeleton() {
  const t = useTranslations("planning.skeleton");
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium animate-pulse">{t("loading")}</p>
      </div>
    </div>
  );
}
