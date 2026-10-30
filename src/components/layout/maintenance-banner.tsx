"use client";

import { useTranslations } from "next-intl";
import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { AlertTriangle } from "lucide-react";

export function MaintenanceBanner() {
  const t = useTranslations("layout.maintenance");
  const { data: config } = useConfig();
  const { can, isLoading } = usePermissions();

  if (isLoading) return null;

  const isMaintenanceMode =
    config?.MAINTENANCE_MODE === "true" || config?.MAINTENANCE_MODE === "1";

  if (!isMaintenanceMode) return null;

  // Only admins/users with bypass see the floating badge
  if (!can("maintenance:bypass")) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg animate-pulse">
      <AlertTriangle className="h-4 w-4" />
      {t("authBadge")}
    </div>
  );
}
