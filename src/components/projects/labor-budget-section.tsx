"use client";

import { useLaborTypes } from "@/hooks/use-labor-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, HardHat } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";

interface BudgetLine {
  laborTypeId: string;
  plannedHours: string;
}

interface LaborBudgetSectionProps {
  budgets: BudgetLine[];
  onChange: (budgets: BudgetLine[]) => void;
  error?: boolean;
}

export function LaborBudgetSection({ budgets, onChange, error }: LaborBudgetSectionProps) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { data: laborTypes } = useLaborTypes();
  const [popoverOpenIdx, setPopoverOpenIdx] = useState<number | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  const usedIds = budgets.map((b) => b.laborTypeId);
  const availableTypes = laborTypes?.filter((lt) => !usedIds.includes(lt.id)) ?? [];

  function addLine() {
    if (availableTypes.length === 0) return;
    onChange([...budgets, { laborTypeId: "", plannedHours: "" }]);
  }

  function updateLine(index: number, field: keyof BudgetLine, value: string) {
    const updated = [...budgets];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  function removeLine(index: number) {
    onChange(budgets.filter((_, i) => i !== index));
  }

  if (!laborTypes || laborTypes.length === 0) {
    return (
      <div className="space-y-1.5">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <HardHat className="h-4 w-4" />
          {t("laborBudget.title")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("laborBudget.noTypes")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold flex items-center gap-1.5">
        <HardHat className="h-4 w-4" />
        {t("laborBudget.title")}
      </div>

      {budgets.length > 0 && (
        <div className="space-y-2">
          {budgets.map((line, idx) => {
            const selectedType = laborTypes.find((lt) => lt.id === line.laborTypeId);
            // Types available for this line = unused types + the currently selected one
            const lineAvailable = laborTypes.filter(
              (lt) => !usedIds.includes(lt.id) || lt.id === line.laborTypeId
            );

            return (
              <div key={idx} className="flex items-center gap-2">
                {/* Type selector */}
                <Popover
                  open={popoverOpenIdx === idx}
                  onOpenChange={(open) => setPopoverOpenIdx(open ? idx : null)}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className={cn("flex-1 justify-between min-w-0 font-normal", !line.laborTypeId && "text-muted-foreground", error && !line.laborTypeId && "border-destructive")}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {selectedType ? (
                          <>
                            <Badge variant="outline" className="font-mono text-[10px] uppercase px-1 py-0 shrink-0">
                              {selectedType.initials}
                            </Badge>
                            <span className="truncate">{selectedType.name}</span>
                          </>
                        ) : <span className="truncate">{t("laborBudget.selectType")}</span>}
                      </span>
                      <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                    <Command defaultValue={line.laborTypeId || undefined}>
                      <CommandInput placeholder={tc("actions.searchPlaceholder")} />
                      <CommandList onWheel={handleWheel}>
                        <CommandEmpty>{t("laborBudget.noTypeAvailable")}</CommandEmpty>
                        <CommandGroup>
                          {lineAvailable.map((lt) => (
                            <CommandItem
                              key={lt.id}
                              value={lt.id}
                              keywords={[lt.name, lt.initials]}
                              onSelect={() => {
                                updateLine(idx, "laborTypeId", lt.id);
                                setPopoverOpenIdx(null);
                              }}
                            >
                              <Badge variant="outline" className="font-mono text-[10px] uppercase px-1 py-0 mr-1.5">
                                {lt.initials}
                              </Badge>
                              {lt.name}
                              {line.laborTypeId === lt.id && <Check className="ml-auto h-4 w-4" />}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {/* Hours input */}
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={line.plannedHours}
                    onChange={(e) => {
                      const v = e.target.value.replace(",", ".");
                      if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) {
                        updateLine(idx, "plannedHours", v);
                      }
                    }}
                    placeholder={t("laborBudget.hoursPlaceholder")}
                    className={cn("w-20 h-9 text-center", error && (!line.laborTypeId || !line.plannedHours || parseFloat(line.plannedHours) <= 0) && "border-destructive")}
                  />
                  <span className="text-xs text-muted-foreground">{t("laborBudget.hoursUnit")}</span>
                </div>

                {/* Remove */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLine(idx)}
                  aria-label={t("laborBudget.removeLine")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addLine}
        disabled={availableTypes.length === 0 && budgets.every((b) => !!b.laborTypeId)}
      >
        <Plus className="h-4 w-4 mr-1" />
        {t("laborBudget.addType")}
      </Button>

      {error && (
        <p className="text-xs text-destructive">{t("laborBudget.incomplete")}</p>
      )}
    </div>
  );
}
