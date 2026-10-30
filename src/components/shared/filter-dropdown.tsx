"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ChevronsUpDown, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  id: string;
  name: string;
  color?: string | null;
}

interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function FilterDropdown({ label, options, selected, onChange }: FilterDropdownProps) {
  const t = useTranslations("ui");
  const tc = useTranslations("common");
  const tCommon = useTranslations("common.states");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const filtered = options.filter(
    (o) => !search || o.name.toLowerCase().includes(search.toLowerCase())
  );

  const displayLabel = (() => {
    if (selected.length === 0) return label;
    if (selected.length === 1) {
      const item = options.find((o) => o.id === selected[0]);
      return item?.name ?? label;
    }
    return t("filter.selectedCount", { count: selected.length });
  })();

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size="sm"
          className={cn(
            "h-8 justify-between font-normal gap-1 text-xs min-w-[130px]",
            selected.length === 0 && "text-muted-foreground",
            selected.length > 0 && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300"
          )}
        >
          <span className="truncate flex flex-1 items-center gap-1.5 min-w-0">
            {selected.length === 1 && (() => {
              const item = options.find((o) => o.id === selected[0]);
              return item?.color ? (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
              ) : null;
            })()}
            {displayLabel}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {selected.length > 0 && (
              <Badge className="h-4 min-w-4 px-1 text-[10px] bg-orange-500 text-white hover:bg-orange-500">
                {selected.length}
              </Badge>
            )}
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            name="filter-search"
            autoComplete="off"
            placeholder={tc("actions.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-[220px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="py-3 text-center text-xs text-muted-foreground">{tCommon("noResults")}</p>
          )}
          {filtered.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={isSelected}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                onClick={() => toggle(item.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(item.id); } }}
                tabIndex={0}
              >
                <div className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors",
                  isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                )}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                {item.color && (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="truncate">{item.name}</span>
              </div>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-muted-foreground"
              onClick={() => { onChange([]); setOpen(false); }}
            >
              <X className="h-3 w-3 mr-1" />
              {t("filter.clear")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
