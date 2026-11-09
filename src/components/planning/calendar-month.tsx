"use client";

import { useEffect, useMemo, useState } from "react";
import { format as formatIso, getISOWeek, isSameMonth, isToday, isWeekend, startOfDay, startOfMonth } from "date-fns";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useDateFormat } from "@/hooks/use-date-format";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { busyPeopleOn, layoutBars, plannedHoursOn, type CalendarBar as BarLayout } from "@/lib/utils/calendar-view";
import { CalendarBar, CalendarChip, TASK_FALLBACK_COLOR } from "./calendar-items";
import { CalendarDayTaskBlock } from "./calendar-day-task-block";
import { CalendarLoadBadge, CalendarPeopleBadge } from "./calendar-day-header";
import type { TaskWithUsers } from "@/types";

/** Month grid of the calendar view: whole weeks, tasks of each day in the cells. */

const iso = (d: Date) => formatIso(d, "yyyy-MM-dd");
const isMultiDay = (t: TaskWithUsers) => !!t.endDate && t.endDate !== t.startDate;

/** Single-day tasks of a cell: without times first, then by start time. */
function singleDayTasks(tasks: TaskWithUsers[]): TaskWithUsers[] {
  return tasks
    .filter((t) => !isMultiDay(t))
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/** Days of the grid by weeks of 7. */
function chunkWeeks(days: Date[]): Array<Date[]> {
  const weeks: Array<Date[]> = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

// Desktop geometry (px)
const DAY_HEAD = 26; // day number line
const LINE = 24; // one bar / chip (22) + gap (2)
const MIN_ROW = 104;
const COLUMNS = "2.25rem repeat(7, minmax(0, 1fr))";

export interface CalendarMonthProps {
  /** Any day of the month shown. */
  anchor: Date;
  /** Days of the grid: whole weeks, Monday first. */
  days: Date[];
  /** Tasks of the person over the grid. */
  tasks: TaskWithUsers[];
  /** Tasks of each day (`yyyy-MM-dd`), several-day tasks included. */
  tasksByDay: Map<string, TaskWithUsers[]>;
  holidays: Map<string, { label: string; color: string }>;
  /** Calendar person: cell ids and drag data. */
  columnId: string;
  dailyHours: number;
  /** The "+" buttons are offered (same rules as the other calendar cells). */
  canCreate: boolean;
  dragOverCellId: string | null;
  onOpenDay: (day: Date) => void;
  onOpenWeek: (monday: Date) => void;
  onCreate: (dayStr: string) => void;
  onTaskClick: (taskId: string) => void;
  onTaskContextMenu: (e: React.MouseEvent, taskId: string) => void;
  onDayContextMenu: (e: React.MouseEvent, dayStr: string) => void;
  /** Calendar of everyone: assignees on the tasks, people busy out of `shownPeople` instead of the daily load. */
  everyone?: boolean;
  shownPeople?: ReadonlySet<string>;
}

export function CalendarMonth(props: CalendarMonthProps) {
  const isMobile = useIsMobile();
  if (isMobile) return <MonthAgenda key={iso(startOfMonth(props.anchor))} {...props} />;
  return <MonthGrid {...props} />;
}

// ───────────────────────────── Desktop: month grid ─────────────────────────────

function MonthGrid({
  anchor, days, tasks, tasksByDay, holidays, columnId, dailyHours, canCreate, dragOverCellId,
  onOpenDay, onOpenWeek, onCreate, onTaskClick, onTaskContextMenu, onDayContextMenu, everyone, shownPeople,
}: CalendarMonthProps) {
  const t = useTranslations("planning.calendar");
  const { format } = useDateFormat();
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  // Rows share the available height (scroll only below MIN_ROW per week)
  useEffect(() => {
    if (!body) return;
    const update = () => setBodyHeight(body.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [body]);

  const weeks = useMemo(() => {
    const multiDay = tasks.filter(isMultiDay);
    return chunkWeeks(days).map((week) => {
      const dayStrs = week.map(iso);
      return { week, dayStrs, ...layoutBars(dayStrs, multiDay) };
    });
  }, [days, tasks]);

  const rowHeight = Math.max(MIN_ROW, bodyHeight ? Math.floor(bodyHeight / Math.max(weeks.length, 1)) : MIN_ROW);
  const capacity = Math.max(1, Math.floor((rowHeight - DAY_HEAD - 4) / LINE));

  return (
    <div className="flex h-full min-h-0 flex-col" data-calendar-month>
      <div className="grid shrink-0 border-b bg-muted/40" style={{ gridTemplateColumns: COLUMNS }}>
        <div className="border-r" />
        {weeks[0]?.week.map((day) => (
          <div
            key={iso(day)}
            className={cn(
              "border-r px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide last:border-r-0",
              isWeekend(day) ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            {format(day, "EEE")}
          </div>
        ))}
      </div>

      <div ref={setBody} className="min-h-0 flex-1 overflow-y-auto">
        {weeks.map(({ week, dayStrs, bars, laneCount }) => {
          // Keep at least one line under the bars for the day tasks / "+N"
          const visibleLanes = Math.min(laneCount, Math.max(capacity - 1, 0));
          const weekNumber = getISOWeek(week[0]);
          return (
            <div key={dayStrs[0]} className="grid border-b" style={{ gridTemplateColumns: COLUMNS, height: rowHeight }}>
              <button
                type="button"
                className="flex items-start justify-center border-r pt-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                title={t("openWeek", { week: weekNumber })}
                onClick={() => onOpenWeek(week[0])}
              >
                {t("weekShort", { week: String(weekNumber) })}
              </button>
              <div className="relative col-span-7 grid min-w-0 grid-cols-7">
                {week.map((day, col) => (
                  <MonthCell
                    key={dayStrs[col]}
                    day={day}
                    dayStr={dayStrs[col]}
                    inMonth={isSameMonth(day, anchor)}
                    tasks={tasksByDay.get(dayStrs[col]) ?? []}
                    hiddenBars={bars.filter((b) => b.lane >= visibleLanes && b.start <= col && col < b.start + b.length).length}
                    visibleLanes={visibleLanes}
                    capacity={capacity}
                    holiday={holidays.get(dayStrs[col]) ?? null}
                    columnId={columnId}
                    dailyHours={dailyHours}
                    canCreate={canCreate}
                    isDragOver={dragOverCellId === `${columnId}:${dayStrs[col]}`}
                    onOpenDay={onOpenDay}
                    onCreate={onCreate}
                    onTaskClick={onTaskClick}
                    onTaskContextMenu={onTaskContextMenu}
                    onDayContextMenu={onDayContextMenu}
                    everyone={everyone}
                    shownPeople={shownPeople}
                  />
                ))}
                {bars.filter((b) => b.lane < visibleLanes).map((bar) => (
                  <MonthBar
                    key={`${bar.task.id}:${dayStrs[0]}`}
                    bar={bar}
                    weekKey={dayStrs[0]}
                    columnId={columnId}
                    onTaskClick={onTaskClick}
                    onTaskContextMenu={onTaskContextMenu}
                    everyone={everyone}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthBar({ bar, weekKey, columnId, onTaskClick, onTaskContextMenu, everyone }: {
  bar: BarLayout<TaskWithUsers>;
  weekKey: string;
  columnId: string;
  onTaskClick: (taskId: string) => void;
  onTaskContextMenu: (e: React.MouseEvent, taskId: string) => void;
  everyone?: boolean;
}) {
  return (
    <CalendarBar
      task={bar.task}
      draggableId={`cal-month-bar:${bar.task.id}:${weekKey}`}
      columnId={columnId}
      clippedStart={bar.clippedStart}
      clippedEnd={bar.clippedEnd}
      onClick={onTaskClick}
      onContextMenu={onTaskContextMenu}
      showPeople={everyone}
      style={{
        position: "absolute",
        top: DAY_HEAD + bar.lane * LINE,
        left: `calc(${bar.start} * 100% / 7 + ${bar.clippedStart ? 0 : 3}px)`,
        width: `calc(${bar.length} * 100% / 7 - ${(bar.clippedStart ? 0 : 3) + (bar.clippedEnd ? 0 : 3)}px)`,
        zIndex: 2,
      }}
    />
  );
}

interface MonthCellProps {
  day: Date;
  dayStr: string;
  inMonth: boolean;
  tasks: TaskWithUsers[];
  /** Bars of this day that do not fit (counted in "+N"). */
  hiddenBars: number;
  visibleLanes: number;
  capacity: number;
  holiday: { label: string; color: string } | null;
  columnId: string;
  dailyHours: number;
  canCreate: boolean;
  isDragOver: boolean;
  onOpenDay: (day: Date) => void;
  onCreate: (dayStr: string) => void;
  onTaskClick: (taskId: string) => void;
  onTaskContextMenu: (e: React.MouseEvent, taskId: string) => void;
  onDayContextMenu: (e: React.MouseEvent, dayStr: string) => void;
  everyone?: boolean;
  shownPeople?: ReadonlySet<string>;
}

function MonthCell({
  day, dayStr, inMonth, tasks, hiddenBars, visibleLanes, capacity, holiday, columnId, dailyHours, canCreate, isDragOver,
  onOpenDay, onCreate, onTaskClick, onTaskContextMenu, onDayContextMenu, everyone, shownPeople,
}: MonthCellProps) {
  const t = useTranslations("planning.calendar");
  const { format } = useDateFormat();
  const today = isToday(day);
  const singles = useMemo(() => singleDayTasks(tasks), [tasks]);
  const hours = useMemo(() => plannedHoursOn(tasks, dayStr, dailyHours), [tasks, dayStr, dailyHours]);

  const space = capacity - visibleLanes;
  const overflow = hiddenBars > 0 || singles.length > space;
  const shown = overflow ? singles.slice(0, Math.max(space - 1, 0)) : singles;
  const more = singles.length - shown.length + hiddenBars;
  const dayLabel = format(day, "EEEE d MMMM");

  return (
    <div
      data-cell-id={`${columnId}:${dayStr}`}
      className={cn(
        "group relative flex min-w-0 cursor-pointer flex-col overflow-hidden border-r px-0.5 transition-colors last:border-r-0 hover:bg-muted/40",
        !inMonth ? "bg-muted/40" : isWeekend(day) ? "bg-muted/20" : today ? "bg-primary/[0.04]" : "",
        isDragOver && "!bg-primary/10 ring-2 ring-inset ring-primary/40",
      )}
      style={holiday && !isDragOver ? { backgroundColor: `color-mix(in srgb, ${holiday.color} 9%, transparent)` } : undefined}
      onClick={() => onOpenDay(day)}
      onContextMenu={(e) => {
        e.preventDefault();
        onDayContextMenu(e, dayStr);
      }}
    >
      <div className="flex shrink-0 items-center gap-1 px-0.5" style={{ height: DAY_HEAD }}>
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
            today ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "font-medium text-foreground" : "text-muted-foreground",
          )}
          title={t("openDay")}
          aria-label={dayLabel}
        >
          {day.getDate() === 1 ? format(day, "d MMM") : day.getDate()}
        </span>
        {holiday && (
          <span className="min-w-0 truncate text-[10px] font-medium" style={{ color: holiday.color }} title={holiday.label}>
            {holiday.label}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {canCreate && (
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={t("newTaskOn", { date: dayLabel })}
              title={t("newTaskOn", { date: dayLabel })}
              onClick={(e) => {
                e.stopPropagation();
                onCreate(dayStr);
              }}
            >
              <Plus className="size-3.5" />
            </button>
          )}
          {everyone ? (
            <CalendarPeopleBadge busy={shownPeople ? busyPeopleOn(tasks, dayStr, shownPeople) : 0} total={shownPeople?.size ?? 0} />
          ) : (
            <CalendarLoadBadge hours={hours} dailyHours={dailyHours} />
          )}
        </span>
      </div>
      {visibleLanes > 0 && <div className="shrink-0" style={{ height: visibleLanes * LINE }} />}
      <div className="flex min-w-0 flex-col gap-0.5">
        {shown.map((task) => (
          <CalendarChip
            key={task.id}
            task={task}
            draggableId={`cal-month:${task.id}:${dayStr}`}
            columnId={columnId}
            onClick={onTaskClick}
            onContextMenu={onTaskContextMenu}
            showPeople={everyone}
          />
        ))}
        {more > 0 && (
          <button
            type="button"
            className="h-[22px] shrink-0 rounded px-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDay(day);
            }}
          >
            {t("more", { count: more })}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Mobile: compact month + day agenda ───────────────────────

function MonthAgenda({
  anchor, days, tasksByDay, holidays, columnId, dailyHours, canCreate,
  onOpenDay, onCreate, onTaskClick, onTaskContextMenu, everyone, shownPeople,
}: CalendarMonthProps) {
  const t = useTranslations("planning.calendar");
  const { format } = useDateFormat();
  // Selected day: today in the current month, otherwise the 1st (reset per month through the key)
  const [selected, setSelected] = useState(() => {
    const today = startOfDay(new Date());
    return isSameMonth(today, anchor) ? today : startOfMonth(anchor);
  });
  const selectedStr = iso(selected);
  const dayTasks = tasksByDay.get(selectedStr) ?? [];
  const holiday = holidays.get(selectedStr) ?? null;
  const selectedLabel = format(selected, "EEEE d MMMM");
  const weeks = useMemo(() => chunkWeeks(days), [days]);

  return (
    <div className="h-full overflow-y-auto" data-calendar-month>
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {weeks[0]?.map((day) => (
          <div key={iso(day)} className="py-1 text-center text-[11px] font-medium uppercase text-muted-foreground">
            {format(day, "EEEEE")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-b">
        {days.map((day) => {
          const dayStr = iso(day);
          const tasks = tasksByDay.get(dayStr) ?? [];
          const isSelected = dayStr === selectedStr;
          const today = isToday(day);
          const inMonth = isSameMonth(day, anchor);
          const dayHoliday = holidays.get(dayStr);
          return (
            <button
              key={dayStr}
              type="button"
              aria-pressed={isSelected}
              aria-label={format(day, "EEEE d MMMM")}
              className={cn(
                "flex h-12 flex-col items-center gap-1 border-b border-r border-border/60 pt-1 transition-colors [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/40",
              )}
              style={dayHoliday ? { backgroundColor: `color-mix(in srgb, ${dayHoliday.color} 12%, transparent)` } : undefined}
              onClick={() => setSelected(day)}
            >
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  isSelected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : today
                      ? "font-semibold text-primary ring-1 ring-primary"
                      : inMonth ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {day.getDate()}
              </span>
              <span className="flex h-1.5 items-center gap-0.5">
                {tasks.slice(0, 3).map((task) => (
                  <span key={task.id} className="size-1.5 rounded-full" style={{ backgroundColor: task.project?.color || TASK_FALLBACK_COLOR }} />
                ))}
                {tasks.length > 3 && <span className="text-[8px] leading-none text-muted-foreground">+{tasks.length - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <section className="space-y-2 p-3" aria-label={selectedLabel}>
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold first-letter:uppercase">{selectedLabel}</h3>
          {everyone ? (
            <CalendarPeopleBadge busy={shownPeople ? busyPeopleOn(dayTasks, selectedStr, shownPeople) : 0} total={shownPeople?.size ?? 0} />
          ) : (
            <CalendarLoadBadge hours={plannedHoursOn(dayTasks, selectedStr, dailyHours)} dailyHours={dailyHours} />
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onOpenDay(selected)}>
              {t("openDay")}
            </Button>
            {canCreate && (
              <Button size="icon" className="size-7" aria-label={t("newTaskOn", { date: selectedLabel })} onClick={() => onCreate(selectedStr)}>
                <Plus className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {holiday && <p className="text-xs font-medium" style={{ color: holiday.color }}>{holiday.label}</p>}
        {dayTasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("dayEmpty")}</p>
        ) : (
          dayTasks.map((task) => (
            <CalendarDayTaskBlock
              key={task.id}
              task={task}
              columnId={columnId}
              draggableKey={selectedStr}
              onClick={onTaskClick}
              onContextMenu={onTaskContextMenu}
              showPeople={everyone}
            />
          ))
        )}
      </section>
    </div>
  );
}
