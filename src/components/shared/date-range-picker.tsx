"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { addDays, differenceInCalendarDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { useDateFormat } from "@/hooks/use-date-format";

/** Shortcuts: label `ui.dateRange.presets.<unit>` built at render time. */
const RANGE_PRESETS: { unit: "weeks" | "months"; count: number; days: number }[] = [
  { unit: "weeks", count: 1, days: 7 },
  { unit: "weeks", count: 2, days: 14 },
  { unit: "months", count: 1, days: 30 },
  { unit: "months", count: 2, days: 60 },
  { unit: "months", count: 3, days: 90 },
];

export interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (start: Date, end: Date) => void;
  /** Action run by the "Today" button. When provided, it takes precedence
   *  over the local computation (today + currentSpan days). Lets a parent
   *  apply its own logic — e.g. reset to the configured default
   *  duration (`PLANNING_DEFAULT_NB_MONTHS`). */
  onGoToToday?: () => void;
}

/**
 * Range date picker with arrows/today shortcut + presets (1 week → 3 months, past/future)
 * + two-click manual selection on a two-month calendar. Used by /planning and /tasks.
 * Visually identical on both pages.
 */
export function DateRangePicker({ startDate, endDate, onChange, onGoToToday }: DateRangePickerProps) {
  const t = useTranslations("ui.dateRange");
  const tTime = useTranslations("common.time");
  const { format } = useDateFormat();
  // i18n-dynamic: ui.dateRange.presets.*
  const presetLabel = (unit: "weeks" | "months", count: number) => t(`presets.${unit}`, { count });
  const [open, setOpen] = useState(false);
  const [pickerFrom, setPickerFrom] = useState<Date | null>(null);

  const currentSpan = differenceInCalendarDays(endDate, startDate) + 1;

  const handleOpenChange = useCallback((o: boolean) => {
    setOpen(o);
    if (o) setPickerFrom(null);
  }, []);

  const handleDayClick = useCallback((day: Date) => {
    if (!pickerFrom) {
      setPickerFrom(day);
    } else {
      const from = pickerFrom <= day ? pickerFrom : day;
      const to = pickerFrom <= day ? day : pickerFrom;
      onChange(from, to);
      setPickerFrom(null);
      setOpen(false);
    }
  }, [pickerFrom, onChange]);

  const calendarSelected: DateRange | undefined = pickerFrom
    ? { from: pickerFrom, to: undefined }
    : { from: startDate, to: endDate };

  const handlePreset = useCallback((days: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    onChange(today, addDays(today, days - 1));
    setPickerFrom(null);
    setOpen(false);
  }, [onChange]);

  const handlePresetPast = useCallback((days: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    onChange(addDays(today, -(days - 1)), today);
    setPickerFrom(null);
    setOpen(false);
  }, [onChange]);

  const navigateBackward = useCallback(() => {
    const newEnd = addDays(startDate, -1);
    const newStart = addDays(newEnd, -(currentSpan - 1));
    onChange(newStart, newEnd);
  }, [startDate, currentSpan, onChange]);

  const navigateForward = useCallback(() => {
    const newStart = addDays(endDate, 1);
    const newEnd = addDays(newStart, currentSpan - 1);
    onChange(newStart, newEnd);
  }, [endDate, currentSpan, onChange]);

  const goToToday = useCallback(() => {
    if (onGoToToday) {
      onGoToToday();
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    onChange(today, addDays(today, currentSpan - 1));
  }, [currentSpan, onChange, onGoToToday]);

  const rangeLabel =
    format(startDate, "d MMM") +
    " — " +
    format(endDate, "d MMM yyyy");
  // Compact version for mobile: "11/05 → 10/07" (saves ~70 px vs the long label).
  const rangeLabelShort =
    format(startDate, "d/MM") +
    " → " +
    format(endDate, "d/MM");

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" onClick={navigateBackward} aria-label={t("previousPeriod")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("previousPeriod")}</TooltipContent>
      </Tooltip>
      <Button variant="outline" size="sm" className="h-8 px-2 text-xs md:px-3 md:text-sm" onClick={goToToday}>
        <CalendarDays className="mr-1 h-4 w-4 hidden sm:inline-block" />
        <span className="sm:hidden">{t("todayShort")}</span>
        <span className="hidden sm:inline">{tTime("today")}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" onClick={navigateForward} aria-label={t("nextPeriod")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("nextPeriod")}</TooltipContent>
      </Tooltip>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-1.5 text-[11px] text-muted-foreground hover:text-foreground md:px-2 md:text-sm">
            <span className="md:hidden">{rangeLabelShort}</span>
            <span className="hidden md:inline">{rangeLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
          <div className="flex flex-col">
            <div className="border-b px-3 py-2 space-y-1.5">
              <p className="text-[10px] text-muted-foreground mb-1">{t("shortcuts")}</p>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">{t("upcoming")}</span>
                {RANGE_PRESETS.map(({ unit, count, days }) => (
                  <Button
                    key={`f${days}`}
                    variant={currentSpan === days && startDate <= new Date() ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handlePreset(days)}
                  >
                    {presetLabel(unit, count)}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">{t("past")}</span>
                {RANGE_PRESETS.map(({ unit, count, days }) => (
                  <Button
                    key={`p${days}`}
                    variant={currentSpan === days && endDate <= new Date() ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handlePresetPast(days)}
                  >
                    {presetLabel(unit, count)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="px-3 pb-2 pt-1">
              {pickerFrom ? (
                <p className="text-xs text-muted-foreground">
                  {t.rich("startPicked", {
                    date: format(pickerFrom, "d MMMM yyyy"),
                    b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                  })}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("hint")}</p>
              )}
            </div>
            <Calendar
              mode="range"
              selected={calendarSelected}
              onDayClick={handleDayClick}
              numberOfMonths={2}
              defaultMonth={startDate}
              weekStartsOn={1}
              showOutsideDays={false}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
