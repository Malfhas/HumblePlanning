"use client";

import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";

export function ChartEmpty({ message }: { message?: string }) {
  const t = useTranslations("stats");
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <BarChart3 className="h-10 w-10 mb-2 opacity-30" />
      <p className="text-sm">{message || t("empty")}</p>
    </div>
  );
}
