import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";
import { getDemoResetTime, isDemoMode } from "@/lib/demo";

/** Demo instance: a reminder that the data is reset every night and administration is off. */
export async function DemoBanner() {
  if (!isDemoMode()) return null;
  const t = await getTranslations("layout.demo");
  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>{t("banner", { time: getDemoResetTime() })}</span>
    </div>
  );
}
