"use client";

import { useMemo } from "react";
import { eachDayOfInterval, format, getMonth, getISOWeek, isWeekend, isToday, getISOWeekYear } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { cn } from "@/lib/utils";
import { usePlanningStore } from "@/stores/planning-store";

export type HolidayInfo = { label: string; color: string };
export type HolidayMap = Map<string, HolidayInfo>;

interface GridHeaderProps {
  holidays: HolidayMap;
}

interface MonthGroup {
  label: string;
  colSpan: number;
}

interface WeekGroup {
  week: number;
  colSpan: number;
}

export function GridHeader({ holidays }: GridHeaderProps) {
  const { startDate, endDate, cellWidth } = usePlanningStore();
  const t = useTranslations("planning");
  const { dateLocale } = useDateFormat();

  const days = useMemo(
    () => eachDayOfInterval({ start: startDate, end: endDate }),
    [startDate, endDate]
  );

  const months = useMemo(() => {
    const groups: MonthGroup[] = [];
    let currentMonth = -1;
    for (const day of days) {
      const m = getMonth(day);
      if (m !== currentMonth) {
        groups.push({ label: format(day, "MMMM yyyy", { locale: dateLocale }), colSpan: 1 });
        currentMonth = m;
      } else {
        groups[groups.length - 1].colSpan++;
      }
    }
    return groups;
  }, [days, dateLocale]);

  const weeks = useMemo(() => {
    const groups: WeekGroup[] = [];
    let currentWeek = -1;
    for (const day of days) {
      const w = getISOWeek(day);
      if (w !== currentWeek) {
        groups.push({ week: w, colSpan: 1 });
        currentWeek = w;
      } else {
        groups[groups.length - 1].colSpan++;
      }
    }
    return groups;
  }, [days]);

  const totalWidth = days.length * cellWidth;

  return (
    <div className="sticky top-0 z-20 bg-background">
      {/* Month row */}
      <div className="flex" style={{ width: `calc(var(--sidebar-width) + ${totalWidth}px)` }}>
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-b bg-background"
          style={{ width: "var(--sidebar-width)" }}
        />
        {months.map((month, i) => (
          <div
            key={i}
            className="border-r border-b px-2 py-1 text-xs font-semibold capitalize truncate shrink-0 bg-background"
            style={{ width: month.colSpan * cellWidth }}
          >
            {month.label}
          </div>
        ))}
      </div>

      {/* Week row */}
      <div className="flex" style={{ width: `calc(var(--sidebar-width) + ${totalWidth}px)` }}>
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-b bg-background flex items-center justify-end px-2 text-[10px] text-muted-foreground"
          style={{ width: "var(--sidebar-width)" }}
        >
          {t("canvas.weekAbbr")}
        </div>
        {weeks.map((wg, i) => (
          <div
            key={i}
            className="border-r border-b px-1 py-0.5 text-[10px] text-center text-muted-foreground shrink-0 bg-muted"
            style={{ width: wg.colSpan * cellWidth }}
          >
            {t("canvas.weekLabel", { week: wg.week })}
          </div>
        ))}
      </div>

      {/* Day row */}
      <div className="flex" style={{ width: `calc(var(--sidebar-width) + ${totalWidth}px)` }}>
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-b bg-background"
          style={{ width: "var(--sidebar-width)" }}
        />
        {days.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const weekend = isWeekend(day);
          const holiday = holidays.get(dateStr);
          const today = isToday(day);

          return (
            <div
              key={dateStr}
              className={cn(
                "flex flex-col items-center justify-center border-r border-b py-0.5 text-[10px] leading-tight shrink-0 relative z-10",
                weekend ? "bg-muted" : "bg-background",
                today && "bg-orange-100 dark:bg-orange-950/80 font-bold"
              )}
              style={{
                width: cellWidth,
                ...(holiday && !today ? { backgroundColor: `color-mix(in oklch, ${holiday.color} 12%, var(--color-background))` } : {}),
              }}
            >
              <span className={cn("text-muted-foreground", today && "!text-orange-600 dark:!text-orange-400 font-semibold")}>
                {format(day, "EEE", { locale: dateLocale }).charAt(0).toUpperCase()}
              </span>
              {today ? (
                <span className="bg-orange-500 text-white rounded-full size-[18px] flex items-center justify-center text-[10px] font-bold">
                  {format(day, "d")}
                </span>
              ) : (
                <span>{format(day, "d")}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
