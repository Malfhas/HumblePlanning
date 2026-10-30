"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterItem {
  id: string;
  name: string;
  color?: string | null;
}

interface FilterMultiSelectProps {
  label: string;
  items: FilterItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Optional popover content width class (default: w-80) */
  widthClass?: string;
}

/**
 * Multi-select filter button used across all list pages (users, projects,
 * vehicles, resources, etc.). Visually consistent: outline
 * button turning orange when values are selected, count badge, searchable
 * popover with checkboxes and optional color dots.
 */
export function FilterMultiSelect({
  label,
  items,
  selected,
  onChange,
  widthClass = "w-80",
}: FilterMultiSelectProps) {
  const t = useTranslations("ui.search");
  const tc = useTranslations("common");
  const tCommon = useTranslations("common.states");
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };
  const count = selected.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs gap-1.5",
            count > 0 && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300",
          )}
        >
          {label}
          {count > 0 && (
            <Badge className="h-4 min-w-4 px-1 text-[10px] bg-orange-500 text-white hover:bg-orange-500">
              {count}
            </Badge>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn(widthClass, "p-0")} align="start">
        <Command>
          <CommandInput placeholder={tc("actions.searchPlaceholder")} />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{tCommon("noResults")}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem key={item.id} value={item.id} keywords={[item.name]} onSelect={() => toggle(item.id)}>
                  <Checkbox checked={selected.includes(item.id)} className="mr-2 pointer-events-none" />
                  {item.color && (
                    <span
                      className="mr-1.5 h-2.5 w-2.5 rounded-full shrink-0 inline-block"
                      style={{ backgroundColor: item.color }}
                    />
                  )}
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
