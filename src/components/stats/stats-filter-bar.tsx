"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useStatsFilterStore } from "@/stores/stats-filter-store";
import { useTeams } from "@/hooks/use-teams";
import { useUsers } from "@/hooks/use-users";
import { useProjects } from "@/hooks/use-projects";
import { useLaborTypes } from "@/hooks/use-labor-types";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { useConfig } from "@/hooks/use-config";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CalendarDays, RotateCcw, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useDateFormat } from "@/hooks/use-date-format";

// ─── Multi-select with search ───
function MultiSelectFilter({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: { id: string; name: string; color?: string | null }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("stats.filters");
  const tc = useTranslations("common");
  const [search, setSearch] = useState("");
  const filtered = items.filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 text-xs px-3 gap-1.5", selected.length > 0 && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300")}>
          {label}
          {selected.length > 0 && (
            <Badge className="h-4 min-w-4 px-1 text-[10px] bg-orange-500 text-white hover:bg-orange-500">{selected.length}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            name="stats-search"
            autoComplete="off"
            placeholder={tc("actions.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-3">{tc("states.noResults")}</p>
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
              >
                <div className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs",
                  isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                )}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                {item.color && (
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                )}
                <span className="truncate text-xs">{item.name}</span>
              </div>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="border-t p-1.5">
            <Button variant="ghost" size="sm" className="h-6 w-full text-xs" onClick={() => onChange([])}>
              {t("clearAll")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function StatsFilterBar() {
  const t = useTranslations("stats.filters");
  const tc = useTranslations("common");
  const { format: formatLocalized } = useDateFormat();
  const store = useStatsFilterStore();
  const { data: businessUnits } = useBusinessUnits();
  const { data: teams } = useTeams();
  // unscoped=true : on stats pages, pages:stats_* grants full visibility of
  // users & projects (filtered only by the top-left BU selector, not by scope).
  const { data: users } = useUsers(undefined, false, true);
  const { data: projects } = useProjects(undefined, true, true);
  const { data: laborTypes } = useLaborTypes();

  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const setPreset = (preset: string) => {
    const now = new Date();
    let start: Date;
    switch (preset) {
      case "month": start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case "quarter": start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
      case "semester": start = new Date(now.getFullYear(), now.getMonth() >= 6 ? 6 : 0, 1); break;
      case "year": start = new Date(now.getFullYear(), 0, 1); break;
      case "12months":
      default: start = new Date(now.getFullYear(), now.getMonth() - 11, 1); break;
    }
    store.setStartDate(start.toISOString().split("T")[0]);
    store.setEndDate(now.toISOString().split("T")[0]);
  };

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      {/* Row 1: Dates + Presets + Granularity + Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Start date picker */}
        <Popover open={startOpen} onOpenChange={setStartOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs justify-start w-[150px]">
              <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
              {store.startDate ? formatLocalized(parseISO(store.startDate), "d MMM yyyy") : t("start")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={store.startDate ? parseISO(store.startDate) : undefined}
              onSelect={(date) => {
                if (date) store.setStartDate(format(date, "yyyy-MM-dd"));
                setStartOpen(false);
              }}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>

        <span className="text-xs text-muted-foreground">→</span>

        {/* End date picker */}
        <Popover open={endOpen} onOpenChange={setEndOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs justify-start w-[150px]">
              <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
              {store.endDate ? formatLocalized(parseISO(store.endDate), "d MMM yyyy") : t("end")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={store.endDate ? parseISO(store.endDate) : undefined}
              onSelect={(date) => {
                if (date) store.setEndDate(format(date, "yyyy-MM-dd"));
                setEndOpen(false);
              }}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>

        {/* Presets */}
        <div className="flex gap-1">
          {[
            { key: "month", label: t("presets.month") },
            { key: "quarter", label: t("presets.quarter") },
            { key: "year", label: t("presets.year") },
            { key: "12months", label: t("presets.last12Months") },
          ].map((p) => (
            <Button key={p.key} variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => setPreset(p.key)}>
              {p.label}
            </Button>
          ))}
        </div>

        {/* Granularity */}
        <Select value={store.granularity} onValueChange={(v) => store.setGranularity(v as any)}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{t("granularity.day")}</SelectItem>
            <SelectItem value="week">{t("granularity.week")}</SelectItem>
            <SelectItem value="month">{t("granularity.month")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={store.reset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          {tc("actions.reset")}
        </Button>

      </div>

      {/* Row 2: Multi-select filters */}
      <div className="flex flex-wrap gap-2">
        {businessUnits && businessUnits.length > 0 && (
          <MultiSelectFilter
            label={tc("entities.businessUnits")}
            items={businessUnits.map((bu: any) => ({ id: bu.id, name: bu.name, color: bu.color }))}
            selected={store.businessUnitIds}
            onChange={store.setBusinessUnitIds}
          />
        )}
        {teams && teams.length > 0 && (
          <MultiSelectFilter
            label={tc("entities.teams")}
            items={teams.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            selected={store.teamIds}
            onChange={store.setTeamIds}
          />
        )}
        {users && (users as any[]).length > 0 && (
          <MultiSelectFilter
            label={tc("entities.users")}
            items={(users as any[]).map((u) => ({
              id: u.id,
              name: u.displayName || [u.firstName, u.name].filter(Boolean).join(" ") || u.name,
              color: u.color,
            }))}
            selected={store.userIds}
            onChange={store.setUserIds}
          />
        )}
        {projects && (projects as any[]).length > 0 && (
          <MultiSelectFilter
            label={tc("entities.projects")}
            items={(projects as any[]).filter((p) => p.status !== "archived").map((p) => ({ id: p.id, name: p.name, color: p.color }))}
            selected={store.projectIds}
            onChange={store.setProjectIds}
          />
        )}
        {laborTypes && laborTypes.length > 0 && (
          <MultiSelectFilter
            label={t("laborTypes")}
            items={laborTypes.map((lt) => ({ id: lt.id, name: `${lt.initials} — ${lt.name}` }))}
            selected={store.laborTypeIds}
            onChange={store.setLaborTypeIds}
          />
        )}

        {/* Weekend/Holiday toggles */}
        <CapacityToggles />
      </div>
    </div>
  );
}

function CapacityToggles() {
  const t = useTranslations("stats.filters");
  const store = useStatsFilterStore();
  const { data: appConfig } = useConfig();
  const configWeekends = appConfig?.INCLUDE_WEEKENDS === "true";
  const configHolidays = appConfig?.INCLUDE_HOLIDAYS === "true";
  const weekends = store.includeWeekends ?? configWeekends;
  const holidays = store.includeHolidays ?? configHolidays;

  return (
    <>
      <div className="w-px h-5 bg-border mx-1" />
      <div className="flex items-center gap-1.5">
        <Switch
          id="include-weekends"
          checked={weekends}
          onCheckedChange={(v) => store.setIncludeWeekends(v === configWeekends ? null : !!v)}
          className="scale-75"
        />
        <Label htmlFor="include-weekends" className="text-xs cursor-pointer whitespace-nowrap">{t("weekends")}</Label>
      </div>
      <div className="flex items-center gap-1.5">
        <Switch
          id="include-holidays"
          checked={holidays}
          onCheckedChange={(v) => store.setIncludeHolidays(v === configHolidays ? null : !!v)}
          className="scale-75"
        />
        <Label htmlFor="include-holidays" className="text-xs cursor-pointer whitespace-nowrap">{t("holidays")}</Label>
      </div>
    </>
  );
}
