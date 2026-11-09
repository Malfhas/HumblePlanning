"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlanningStore } from "@/stores/planning-store";
import { useDateFormat } from "@/hooks/use-date-format";
import { cn } from "@/lib/utils";
import { CALENDAR_SPANS, calendarWindow } from "@/lib/utils/calendar-view";
import { CalendarPersonSelect, useCalendarPeople } from "./calendar-person-select";

/**
 * Toolbar parts of the calendar view (`/planning`): period navigation
 * (previous / today / next + date picker) and options (person, hours / days,
 * period, 24 h).
 */

/** Previous / Today / Next and the period label (opens a date picker). */
export function CalendarNavigation() {
  const t = useTranslations("planning.toolbar");
  const tTime = useTranslations("common.time");
  const { format, intlTag } = useDateFormat();
  const startDate = usePlanningStore((s) => s.startDate);
  const span = usePlanningStore((s) => s.calendarDays);
  const navigateCalendar = usePlanningStore((s) => s.navigateCalendar);
  const jumpCalendarTo = usePlanningStore((s) => s.jumpCalendarTo);
  const goToToday = usePlanningStore((s) => s.goToToday);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { start, end } = calendarWindow(startDate, span);
  const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(intlTag) + s.slice(1);
  let label: string;
  let shortLabel: string;
  if (span === "month") {
    // The month of the anchor (the grid starts on the Monday before its 1st)
    label = capitalize(new Intl.DateTimeFormat(intlTag, { month: "long", year: "numeric" }).format(startDate));
    shortLabel = label;
  } else if (span === 1) {
    label = capitalize(format(start, "EEEE d MMMM yyyy"));
    shortLabel = capitalize(format(start, "EEE d MMM"));
  } else {
    label = new Intl.DateTimeFormat(intlTag, { day: "numeric", month: "long", year: "numeric" }).formatRange(start, end);
    shortLabel = new Intl.DateTimeFormat(intlTag, { day: "numeric", month: "short" }).formatRange(start, end);
  }

  const previous = span === "month" ? t("calendar.previousMonth") : span === 1 ? t("previousDay") : t("calendar.previousDays", { count: span });
  const next = span === "month" ? t("calendar.nextMonth") : span === 1 ? t("nextDay") : t("calendar.nextDays", { count: span });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" onClick={() => navigateCalendar(-1)} aria-label={previous}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{previous}</TooltipContent>
      </Tooltip>
      <Button variant="outline" size="sm" className="h-8 px-2 text-xs md:px-3 md:text-sm" onClick={goToToday}>
        <CalendarDays className="mr-1 hidden h-4 w-4 sm:inline-block" />
        <span className="sm:hidden">{t("todayShort")}</span>
        <span className="hidden sm:inline">{tTime("today")}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" onClick={() => navigateCalendar(1)} aria-label={next}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{next}</TooltipContent>
      </Tooltip>

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 min-w-0 shrink px-2 text-xs font-semibold md:text-sm"
            title={t("calendar.jumpTo")}
            data-calendar-period
          >
            <span className="truncate md:hidden">{shortLabel}</span>
            <span className="hidden truncate md:inline">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
          <Calendar
            mode="single"
            selected={startDate}
            onSelect={(day) => {
              if (!day) return;
              jumpCalendarTo(day);
              setPickerOpen(false);
            }}
            defaultMonth={startDate}
            weekStartsOn={1}
            showWeekNumber
            showOutsideDays={false}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

const SEGMENT = "inline-flex h-8 items-center gap-0.5 rounded-md border bg-background p-0.5";
const segmentItem = (active: boolean) =>
  cn(
    "inline-flex h-[26px] min-w-7 items-center justify-center gap-1 rounded-[5px] px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

/** Person, hours / days, period (1, 3, 5, 7 days or month) and 24 h. */
export function CalendarOptions({ currentUserId }: { currentUserId: string | null }) {
  const t = useTranslations("planning.toolbar");
  const calendarDays = usePlanningStore((s) => s.calendarDays);
  const setCalendarDays = usePlanningStore((s) => s.setCalendarDays);
  const calendarUserId = usePlanningStore((s) => s.calendarUserId);
  const setCalendarUserId = usePlanningStore((s) => s.setCalendarUserId);
  const calendarShow24h = usePlanningStore((s) => s.calendarShow24h);
  const toggleCalendar24h = usePlanningStore((s) => s.toggleCalendar24h);
  const calendarPersonalView = usePlanningStore((s) => s.calendarPersonalView);
  const setCalendarPersonalView = usePlanningStore((s) => s.setCalendarPersonalView);
  const isMonth = calendarDays === "month";

  // People the signed-in user may see, limited to the selected business units
  const people = useCalendarPeople();

  return (
    <>
      <CalendarPersonSelect
        people={people}
        value={calendarUserId ?? currentUserId}
        currentUserId={currentUserId}
        onChange={(id) => setCalendarUserId(id === currentUserId ? null : id)}
      />

      {/* View: hours / day cards (the month has its own layout) */}
      {!isMonth && (
        <div className={SEGMENT} role="group" aria-label={t("calendar.viewLabel")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={segmentItem(calendarPersonalView === "hours")}
                aria-pressed={calendarPersonalView === "hours"}
                aria-label={t("calendar.hoursView")}
                onClick={() => setCalendarPersonalView("hours")}
              >
                <Clock className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("calendar.hoursView")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={segmentItem(calendarPersonalView === "days")}
                aria-pressed={calendarPersonalView === "days"}
                aria-label={t("calendar.daysView")}
                onClick={() => setCalendarPersonalView("days")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("calendar.daysView")}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Period */}
      <div className={SEGMENT} role="group" aria-label={t("calendar.periodLabel")}>
        {CALENDAR_SPANS.map((span) => {
          const active = calendarDays === span;
          const label = span === "month" ? t("calendar.month") : t("calendar.daysShort", { count: span });
          const hint = span === "month" ? t("calendar.monthTooltip") : t("calendar.daysTooltip", { count: span });
          return (
            <Tooltip key={span}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={segmentItem(active)}
                  aria-pressed={active}
                  aria-label={hint}
                  data-calendar-span={span}
                  onClick={() => setCalendarDays(span)}
                >
                  {label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{hint}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* 24 h (hours view only) */}
      {!isMonth && calendarPersonalView === "hours" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={calendarShow24h ? "default" : "outline"}
              size="sm"
              className="h-8 px-2 text-xs"
              aria-pressed={calendarShow24h}
              onClick={toggleCalendar24h}
              data-calendar-24h
            >
              24h
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {calendarShow24h ? t("calendar.showWorkingHours") : t("calendar.show24h")}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
