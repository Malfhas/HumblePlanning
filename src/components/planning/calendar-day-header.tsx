"use client";

import { isToday, isWeekend } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { cn } from "@/lib/utils";
import { dayLoad, type DayLoad } from "@/lib/utils/calendar-view";

const LOAD_CLASSES: Record<Exclude<DayLoad, "empty">, string> = {
  partial: "bg-muted text-muted-foreground",
  full: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  over: "bg-red-500/15 text-red-700 dark:text-red-300",
};

/**
 * Hours planned on a day, colored against the configured working day
 * (DURATION_DAY): partial, full, overloaded. Nothing on an empty day.
 */
export function CalendarLoadBadge({ hours, dailyHours, className }: { hours: number; dailyHours: number; className?: string }) {
  const t = useTranslations("planning.calendar");
  const { formatNumber } = useDateFormat();
  const load = dayLoad(hours, dailyHours);
  if (load === "empty") return null;
  const planned = formatNumber(hours, { maximumFractionDigits: 1 });
  const capacity = formatNumber(dailyHours, { maximumFractionDigits: 1 });
  return (
    <span
      title={t("loadTitle", { level: load, planned, capacity })}
      className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums leading-tight", LOAD_CLASSES[load], className)}
    >
      {t("hours", { hours: planned })}
    </span>
  );
}

/**
 * Calendar of everyone: people busy that day (at least one task) out of the
 * people shown, same look as the load badge: grey while someone is free, green
 * when everyone is busy. Nothing when nobody is busy.
 */
export function CalendarPeopleBadge({ busy, total, className }: { busy: number; total: number; className?: string }) {
  const t = useTranslations("planning.calendar");
  if (busy <= 0 || total <= 0) return null;
  return (
    <span
      title={t("peopleTitle", { busy, total, free: Math.max(total - busy, 0) })}
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums leading-tight",
        LOAD_CLASSES[busy >= total ? "full" : "partial"],
        className,
      )}
    >
      {busy}/{total}
    </span>
  );
}

interface CalendarDayHeaderProps {
  day: Date;
  holiday: { label: string; color: string } | null;
  hours: number;
  dailyHours: number;
  /** Calendar of everyone: people busy that day out of the people shown (instead of the load). */
  people?: { busy: number; total: number };
  /** Opens the day alone (periods of several days). */
  onOpen?: (day: Date) => void;
}

/** Column header of the calendar hours and days views. */
export function CalendarDayHeader({ day, holiday, hours, dailyHours, people, onOpen }: CalendarDayHeaderProps) {
  const t = useTranslations("planning.calendar");
  const { format } = useDateFormat();
  const today = isToday(day);
  const weekend = isWeekend(day);

  const content = (
    <>
      <span className="flex items-center gap-1.5">
        <span className={cn("text-[11px] font-medium uppercase tracking-wide", today ? "text-primary" : "text-muted-foreground")}>
          {format(day, "EEE")}
        </span>
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full text-base font-semibold tabular-nums",
            today ? "bg-primary text-primary-foreground" : weekend ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {format(day, "d")}
        </span>
      </span>
      <span className="flex min-w-0 max-w-full items-center gap-1 text-[10px] leading-tight">
        {holiday ? (
          <span className="truncate font-medium" style={{ color: holiday.color }}>{holiday.label}</span>
        ) : (
          <span className="truncate capitalize text-muted-foreground">{format(day, "MMM")}</span>
        )}
        {people ? <CalendarPeopleBadge busy={people.busy} total={people.total} /> : <CalendarLoadBadge hours={hours} dailyHours={dailyHours} />}
      </span>
    </>
  );

  const className = "flex h-full w-full min-w-0 flex-col items-center justify-center gap-0.5 px-1";
  if (!onOpen) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      className={cn(className, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
      title={t("openDay")}
      onClick={() => onOpen(day)}
    >
      {content}
    </button>
  );
}
