"use client";

import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { MaintenanceScreen } from "@/components/shared/maintenance-screen";

export function MaintenanceGuard({ children }: { children: React.ReactNode }) {
  const { data: config } = useConfig();
  const { can, isLoading } = usePermissions();

  const isMaintenanceMode =
    config?.MAINTENANCE_MODE === "true" || config?.MAINTENANCE_MODE === "1";

  // Don't block while loading permissions (avoid flash)
  if (isLoading || !isMaintenanceMode || can("maintenance:bypass")) {
    return <>{children}</>;
  }

  // User is authenticated but doesn't have bypass permission → full screen maintenance
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <MaintenanceScreen />
    </div>
  );
}
