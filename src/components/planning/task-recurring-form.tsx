"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import type { RecurRule } from "@/lib/validators/task";

interface TaskRecurringFormProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  value: Partial<RecurRule>;
  onChange: (value: Partial<RecurRule>) => void;
  taskStartDate?: string;
}

/** Offered days, week starting on Monday (values = JS getDay index, 0 = Sunday). */
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];

export function TaskRecurringForm({
  enabled,
  onEnabledChange,
  value,
  onChange,
  taskStartDate,
}: TaskRecurringFormProps) {
  const t = useTranslations("taskForm.recurrence");
  const { dateLocale, format: formatLocalized } = useDateFormat();
  const [endDateOpen, setEndDateOpen] = useState(false);
  const dayName = (day: number) => {
    const name = dateLocale.localize.day(day as 0 | 1 | 2 | 3 | 4 | 5 | 6, { width: "wide" });
    return name.charAt(0).toLocaleUpperCase(dateLocale.code) + name.slice(1);
  };

  const update = (patch: Partial<RecurRule>) => {
    onChange({ ...value, ...patch });
  };

  const frequency = value.recurFrequency || 1;
  const typeLabel = value.recurType === "daily"
    ? t("unit.days", { count: frequency })
    : value.recurType === "weekly"
      ? t("unit.weeks", { count: frequency })
      : t("unit.months", { count: frequency });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} id="recur-switch" />
        <Label htmlFor="recur-switch" className="text-sm font-medium">{t("enable")}</Label>
      </div>

      {enabled && (
        <div className="bg-muted/30 border rounded-md p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("type.label")}</Label>
              <Select
                value={value.recurType || "daily"}
                onValueChange={(v) => update({ recurType: v as RecurRule["recurType"] })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t("type.daily")}</SelectItem>
                  <SelectItem value="weekly">{t("type.weekly")}</SelectItem>
                  <SelectItem value="monthly">{t("type.monthly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("frequency")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  autoComplete="off"
                  type="number"
                  min={1}
                  max={30}
                  value={value.recurFrequency || 1}
                  onChange={(e) => update({ recurFrequency: Math.max(1, Math.min(30, parseInt(e.target.value) || 1)) })}
                  className="h-8 text-sm w-16"
                />
                <span className="text-xs text-muted-foreground">{typeLabel}</span>
              </div>
            </div>
          </div>

          {value.recurType === "weekly" && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("dayOfWeek")}</Label>
              <Select
                value={String(value.recurDayOfWeek ?? 1)}
                onValueChange={(v) => update({ recurDayOfWeek: parseInt(v) })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>{dayName(day)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">{t("endDate.label")}</Label>
            <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal h-8 text-sm",
                    !value.recurEndDate && "text-muted-foreground"
                  )}
                >
                  <CalendarDays className="mr-2 h-3.5 w-3.5" />
                  {value.recurEndDate
                    ? formatLocalized(parseISO(value.recurEndDate), "d MMMM yyyy")
                    : t("endDate.placeholder")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={value.recurEndDate ? parseISO(value.recurEndDate) : undefined}
                  onSelect={(date) => {
                    update({ recurEndDate: date ? format(date, "yyyy-MM-dd") : undefined });
                    setEndDateOpen(false);
                  }}
                  defaultMonth={value.recurEndDate ? parseISO(value.recurEndDate) : (taskStartDate ? parseISO(taskStartDate) : undefined)}
                  disabled={taskStartDate ? (day) => day <= parseISO(taskStartDate) : undefined}
                  weekStartsOn={1}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("exception.label")}</Label>
            <Select
              value={value.recurException || "skip"}
              onValueChange={(v) => update({ recurException: v as RecurRule["recurException"] })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">{t("exception.skip")}</SelectItem>
                <SelectItem value="shift">{t("exception.shift")}</SelectItem>
                <SelectItem value="include">{t("exception.include")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
