"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/use-permissions";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { useBuStore } from "@/stores/bu-store";
import { cn } from "@/lib/utils";

export function BuSelector() {
  const t = useTranslations("layout.bu");
  const { buScope, user, isLoading: permLoading } = usePermissions();
  const { data: businessUnits } = useBusinessUnits();
  const { selectedBuIds, toggleBu, selectAll, initialize } = useBuStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!permLoading && user) {
      initialize(user.businessUnitId ?? null);
    }
  }, [permLoading, user, initialize]);

  if (permLoading || !user) return null;

  const allBus = businessUnits ?? [];
  const userBu = allBus.find((bu) => bu.id === user.businessUnitId);
  const isAllSelected = selectedBuIds.length === 0;

  // Build display name
  let displayName = t("all");
  if (!isAllSelected) {
    const names = selectedBuIds
      .map((id) => allBus.find((bu) => bu.id === id)?.name)
      .filter(Boolean);
    displayName = names.length === 1
      ? names[0]!
      : t("selectedCount", { count: names.length });
  }

  // scope:bu_own → disabled static badge
  if (buScope === "own") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground cursor-default">
            <Building2 className="size-4 shrink-0" />
            <span className="hidden sm:inline min-w-[180px] max-w-[300px] truncate text-left">{userBu?.name ?? "\u2014"}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{t("ownOnly")}</TooltipContent>
      </Tooltip>
    );
  }

  // scope:bu_all → interactive multi-select dropdown
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
            isAllSelected ? "text-muted-foreground" : "text-foreground"
          )}
        >
          <Building2 className="size-4 shrink-0" />
          <span className="hidden sm:inline min-w-[180px] max-w-[300px] truncate text-left">{displayName}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                keywords={[t("all"), t("allLong"), "toutes", "tout", "all"]}
                onSelect={() => selectAll()}
              >
                <Building2 className="mr-2 size-4 text-muted-foreground" />
                {t("allLong")}
                {isAllSelected && <Check className="ml-auto size-4" />}
              </CommandItem>
              {allBus.map((bu) => {
                const isSelected = selectedBuIds.includes(bu.id);
                return (
                  <CommandItem
                    key={bu.id}
                    value={bu.id}
                    keywords={[bu.name, bu.number]}
                    onSelect={() => toggleBu(bu.id)}
                  >
                    <Checkbox checked={isSelected} className="mr-2 pointer-events-none" />
                    <span
                      className="mr-1.5 inline-block size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: bu.color || "#8b5cf6" }}
                    />
                    {bu.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
