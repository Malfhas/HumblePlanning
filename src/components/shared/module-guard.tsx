"use client";

import { useTranslations } from "next-intl";
import { useConfig } from "@/hooks/use-config";
import { Ban } from "lucide-react";

// i18n-dynamic: ui.moduleGuard.title.*
/** Modules that can be disabled: setting → title `ui.moduleGuard.title.<module>` (one sentence per module). */
const MODULES = { MODULE_RESOURCES: "resources", MODULE_VEHICLES: "vehicles" } as const;

interface ModuleGuardProps {
  configKey: keyof typeof MODULES;
  children: React.ReactNode;
}

export function ModuleGuard({ configKey, children }: ModuleGuardProps) {
  const t = useTranslations("ui.moduleGuard");
  const { data: config, isLoading } = useConfig();

  if (isLoading) return null;

  const enabled = config?.[configKey] !== "false";
  if (enabled) return <>{children}</>;

  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <Ban className="size-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">{t(`title.${MODULES[configKey]}`)}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("description")}
      </p>
    </div>
  );
}
