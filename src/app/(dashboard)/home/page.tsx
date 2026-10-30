"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePermissions } from "@/hooks/use-permissions";
import { ErrorState } from "@/components/shared/error-state";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  eachDayOfInterval,
  isToday,
  getISOWeek,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ArrowRight,
  Bell,
  Plus,
  Trash2,
  Pencil,
  Paperclip,
  FileX,
  UserPlus,
  UserMinus,
  RefreshCw,
  Calendar,
  PartyPopper,
  Users,
  Truck,
  Wrench,
} from "lucide-react";

import { useProfile } from "@/hooks/use-profile";
import { useNotifications, useMarkAsRead } from "@/hooks/use-notifications";
import { useTasks } from "@/hooks/use-tasks";
import { useVehicleAssignments } from "@/hooks/use-vehicle-assignments";
import { useResourceAssignments } from "@/hooks/use-resource-assignments";
import { useHolidays } from "@/hooks/use-holidays";
import { useTaskPreviewStore } from "@/stores/task-preview-store";
import { useHomeStore } from "@/stores/home-store";
import { cn, contrastColor, formatProjectName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDateFormat } from "@/hooks/use-date-format";
import { useNotificationText } from "@/i18n/notification-text";
import { throwIfNotOk } from "@/lib/api-client";
import type { TaskWithUsers } from "@/types";

// --- Notification type maps (mirrored from notification-bell.tsx) ---

const TASK_NOTIFICATION_TYPES = new Set([
  "task_created", "task_updated", "task_title_changed", "task_dates_changed",
  "task_times_changed", "task_status_changed", "task_project_changed",
  "task_notes_changed", "task_user_added", "task_user_removed",
  "task_file_added", "task_file_deleted",
]);

const TYPE_ICONS: Record<string, React.ElementType> = {
  task_created: Plus, task_deleted: Trash2, task_updated: Pencil,
  task_title_changed: Pencil, task_dates_changed: Calendar,
  task_times_changed: Calendar, task_status_changed: RefreshCw,
  task_project_changed: RefreshCw, task_notes_changed: Pencil,
  task_user_added: UserPlus, task_user_removed: UserMinus,
  task_file_added: Paperclip, task_file_deleted: FileX,
};

const TYPE_COLORS: Record<string, string> = {
  task_created: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  task_deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
  task_updated: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  task_title_changed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  task_dates_changed: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  task_times_changed: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  task_status_changed: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  task_project_changed: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  task_notes_changed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  task_user_added: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  task_user_removed: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  task_file_added: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  task_file_deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
};

// --- Helpers ---

/** Duration in hours and minutes (label written at render time, per language). */
function calcDuration(startTime?: string | null, endTime?: string | null): { hours: number; minutes: string } | null {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMinutes <= 0) return null;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return { hours, minutes: mins > 0 ? String(mins).padStart(2, "0") : "" };
}

function formatTimeShort(time?: string | null): string {
  if (!time) return "";
  return time.slice(0, 5); // "HH:mm:ss" → "HH:mm"
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatWeekRange(weekStart: Date, formatWithLocale: (d: Date, fmt: string) => string): string {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  return `${formatWithLocale(weekStart, "d MMM")} – ${formatWithLocale(weekEnd, "d MMM")}`;
}

function getTasksForDay(tasks: TaskWithUsers[], dayStr: string): TaskWithUsers[] {
  return tasks
    .filter((t) => {
      const start = t.startDate as string;
      const end = (t.endDate as string) || start;
      return start <= dayStr && end >= dayStr;
    })
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

// --- Collaborators ---

interface CollabRow {
  taskId: string;
  projectId: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  userId: string;
  userName: string;
  userFirstName: string | null;
  userColor: string | null;
  userImage: string | null;
  projectName: string | null;
  projectColor: string | null;
}

interface CollabUser {
  id: string;
  displayName: string;
  color: string;
}

/**
 * Find everyone else working on the same project the same day.
 * Dedup by userId so one person shows only once even if they have
 * multiple tasks on the same project that day.
 */
function getCollaboratorsForTaskDay(
  task: TaskWithUsers,
  dayStr: string,
  rows: CollabRow[],
  currentUserId: string,
  intlTag: string,
): CollabUser[] {
  const seen = new Map<string, CollabUser>();
  for (const r of rows) {
    if (r.userId === currentUserId) continue;
    if (r.projectId !== task.projectId) continue;
    const end = r.endDate ?? r.startDate;
    if (r.startDate > dayStr || end < dayStr) continue;
    if (seen.has(r.userId)) continue;
    const displayName = [r.userFirstName, r.userName].filter(Boolean).join(" ") || r.userName;
    seen.set(r.userId, {
      id: r.userId,
      displayName,
      color: r.userColor || "#6b7280",
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, intlTag));
}

// --- Task Card ---

function TaskCard({ task, collaborators, hasVehicle, hasResource }: { task: TaskWithUsers; collaborators?: CollabUser[]; hasVehicle?: boolean; hasResource?: boolean }) {
  const t = useTranslations("home");
  const openPreview = useTaskPreviewStore((s) => s.openPreview);
  const color = task.project?.color || (task.status as { color?: string })?.color || "#3b82f6";
  const duration = calcDuration(task.startTime as string, task.endTime as string);

  return (
    <button
      onClick={() => openPreview(task.id)}
      className="flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/50"
    >
      <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {task.startTime && (
              <>
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{formatTimeShort(task.startTime as string)}</span>
                {task.endTime && (
                  <span className="text-muted-foreground">– {formatTimeShort(task.endTime as string)}</span>
                )}
              </>
            )}
          </div>
          {duration && (
            <Badge variant="secondary" className="shrink-0 text-xs font-normal">
              {duration.minutes
                ? t("duration.hoursMinutes", { hours: duration.hours, minutes: duration.minutes })
                : t("duration.hours", { hours: duration.hours })}
            </Badge>
          )}
        </div>
        {task.project && (
          <p className="mt-1 text-sm font-semibold truncate" style={{ color }}>
            {formatProjectName(task.project)}
            {task.title ? <span className="font-normal text-muted-foreground">{" ｜ "}{task.title}</span> : ""}
          </p>
        )}
        {collaborators && collaborators.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
            {collaborators.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
                style={{ backgroundColor: c.color, color: contrastColor(c.color) }}
                title={c.displayName}
              >
                {c.displayName}
              </span>
            ))}
          </div>
        )}
        {((task.files as unknown[])?.length > 0 || hasVehicle || hasResource) && (
          <div className="mt-1 flex items-center gap-1.5">
            {(task.files as unknown[])?.length > 0 && (
              <Paperclip className="h-3 w-3 text-muted-foreground" />
            )}
            {hasVehicle && (
              <Truck className="h-3 w-3 text-muted-foreground" />
            )}
            {hasResource && (
              <Wrench className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// --- Main Page ---

export default function HomePage() {
  const t = useTranslations("home");
  const tCommon = useTranslations("common");
  const { format: formatWithLocale, intlTag } = useDateFormat();
  const { can, isLoading: permLoading } = usePermissions();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const [weekOffset, setWeekOffset] = useState(0);
  const showCollaborators = useHomeStore((s) => s.showCollaborators);
  const toggleCollaborators = useHomeStore((s) => s.toggleCollaborators);

  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");

  const weekStart = useMemo(
    () => startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 }),
    [weekOffset]
  );
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  const userId = profile?.id;
  const startDateStr = format(weekStart, "yyyy-MM-dd");
  const endDateStr = format(weekEnd, "yyyy-MM-dd");

  // Fetch tasks for the selected week (skip until userId is known)
  const { data: weekTasksData, isLoading: tasksLoading } = useTasks(
    {
      page: 1,
      userId: userId ?? "",
      startDate: startDateStr,
      endDate: endDateStr,
      limit: 500,
    },
    !!userId,
  );

  const weekTasks = weekTasksData?.data ?? [];
  const todayTasks = useMemo(() => getTasksForDay(weekTasks, todayStr), [weekTasks, todayStr]);

  // Load vehicle/resource assignments for icon display
  const { data: vehicleAssignments } = useVehicleAssignments(undefined, startDateStr, endDateStr);
  const { data: resourceAssignments } = useResourceAssignments(undefined, startDateStr, endDateStr);

  // Build sets: projectId:date → has vehicle/resource
  const vehicleProjectDates = useMemo(() => {
    const set = new Set<string>();
    for (const a of vehicleAssignments ?? []) {
      if (!a.projectId) continue;
      const start = new Date(a.startDate);
      const end = new Date(a.endDate || a.startDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        set.add(`${a.projectId}:${d.toISOString().slice(0, 10)}`);
      }
    }
    return set;
  }, [vehicleAssignments]);

  const resourceProjectDates = useMemo(() => {
    const set = new Set<string>();
    for (const a of resourceAssignments ?? []) {
      if (!a.projectId) continue;
      const start = new Date(a.startDate);
      const end = new Date(a.endDate || a.startDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        set.add(`${a.projectId}:${d.toISOString().slice(0, 10)}`);
      }
    }
    return set;
  }, [resourceAssignments]);

  const hasVehicleForTask = useCallback((task: TaskWithUsers, dayStr: string) => {
    return vehicleProjectDates.has(`${task.projectId}:${dayStr}`);
  }, [vehicleProjectDates]);

  const hasResourceForTask = useCallback((task: TaskWithUsers, dayStr: string) => {
    return resourceProjectDates.has(`${task.projectId}:${dayStr}`);
  }, [resourceProjectDates]);

  // Fetch collaborators (same project, same day) when toggle is on
  const { data: collabData } = useQuery({
    queryKey: ["home-collaborators", startDateStr, endDateStr, userId],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate: startDateStr, endDate: endDateStr });
      const res = await fetch(`/api/home/collaborators?${params}`);
      await throwIfNotOk(res);
      return res.json() as Promise<{ data: CollabRow[] }>;
    },
    enabled: showCollaborators && !!userId,
  });
  const collabRows = useMemo<CollabRow[]>(() => collabData?.data ?? [], [collabData]);

  const getCollaborators = useCallback(
    (task: TaskWithUsers, dayStr: string): CollabUser[] | undefined => {
      if (!showCollaborators || !userId) return undefined;
      return getCollaboratorsForTaskDay(task, dayStr, collabRows, userId, intlTag);
    },
    [showCollaborators, userId, collabRows, intlTag],
  );

  // Holidays
  const { data: holidays } = useHolidays(
    format(weekStart, "yyyy-MM-dd"),
    format(weekEnd, "yyyy-MM-dd")
  );
  const holidayMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    if (holidays) {
      for (const h of holidays) {
        const dateStr = typeof h.date === "string" ? h.date.slice(0, 10) : "";
        if (dateStr) m.set(dateStr, { name: h.label || t("holiday.fallback"), color: h.color || "#ef4444" });
      }
    }
    return m;
  }, [holidays, t]);

  // Week pills (5 weeks centered on current offset)
  const weekPills = useMemo(() => {
    return [-2, -1, 0, 1, 2].map((delta) => {
      const offset = weekOffset + delta;
      const ws = startOfWeek(addWeeks(now, offset), { weekStartsOn: 1 });
      return { offset, label: formatWeekRange(ws, formatWithLocale), weekNum: getISOWeek(ws) };
    });
  }, [weekOffset, formatWithLocale]);

  // Redirect if user doesn't have pages:home but has pages:planning
  useEffect(() => {
    if (permLoading) return;
    if (!can("pages:home") && can("pages:planning")) {
      router.replace("/planning");
    }
  }, [permLoading, can, router]);

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tCommon("states.loading")}</p>;
  if (!can("pages:home")) return <ErrorState code={403} compact showBack={false} />;

  if (profileLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-1">
        <div className="h-10 w-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-5 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 min-w-[260px] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const firstName = profile?.firstName || profile?.name || "";

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-1">
      {/* --- Greeting Header --- */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("greeting", { name: firstName })}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{capitalize(formatWithLocale(now, "EEEE d MMMM yyyy"))}</span>
            <Badge variant="outline" className="text-xs">
              {t("weekBadge", { week: getISOWeek(now) })}
            </Badge>
          </div>
        </div>
        <Button
          variant={showCollaborators ? "default" : "outline"}
          size="sm"
          onClick={toggleCollaborators}
          className="shrink-0 gap-1.5"
          title={showCollaborators ? t("collaborators.hide") : t("collaborators.show")}
          aria-label={showCollaborators ? t("collaborators.hide") : t("collaborators.show")}
        >
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline">{t("collaborators.label")}</span>
        </Button>
      </div>

      {/* --- Notifications Carousel --- */}
      <NotificationsCarousel />

      {/* --- Today Section --- */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t("today.title")}</h2>
          <Badge variant="secondary" className="text-xs">
            {t("today.taskCount", { count: todayTasks.length })}
          </Badge>
        </div>
        {tasksLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : todayTasks.length === 0 ? (
          holidayMap.has(todayStr) ? (
            <div className="flex items-center gap-3 rounded-xl border px-4 py-4" style={{ borderColor: holidayMap.get(todayStr)!.color + "40", backgroundColor: holidayMap.get(todayStr)!.color + "10" }}>
              <PartyPopper className="h-6 w-6 shrink-0" style={{ color: holidayMap.get(todayStr)!.color }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: holidayMap.get(todayStr)!.color }}>{holidayMap.get(todayStr)!.name}</p>
                <p className="text-xs text-muted-foreground">{t("holiday.wish")}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-muted-foreground">
              <CalendarDays className="h-8 w-8" />
              <p className="text-sm">{t("today.empty")}</p>
            </div>
          )
        ) : (
          <div className="space-y-2">
            {todayTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                collaborators={getCollaborators(task, todayStr)}
                hasVehicle={hasVehicleForTask(task, todayStr)}
                hasResource={hasResourceForTask(task, todayStr)}
              />
            ))}
          </div>
        )}
      </section>

      {/* --- Week View --- */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("week.title")}</h2>

        {/* Week Selector Pills */}
        <WeekPills
          weekPills={weekPills}
          weekOffset={weekOffset}
          onSelect={setWeekOffset}
        />

        {/* Daily Task List */}
        {tasksLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="mb-2 h-5 w-32 animate-pulse rounded bg-muted" />
                <div className="h-16 animate-pulse rounded-xl bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {weekDays.map((day) => {
              const dayStr = format(day, "yyyy-MM-dd");
              const dayTasks = getTasksForDay(weekTasks, dayStr);
              const today = isToday(day);

              return (
                <div key={dayStr}>
                  <div className="mb-2 flex items-center gap-2">
                    {today ? (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {format(day, "d")}
                      </span>
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-muted-foreground">
                        {format(day, "d")}
                      </span>
                    )}
                    <span className={cn("text-sm font-medium", today ? "text-primary font-semibold" : "text-foreground")}>
                      {capitalize(formatWithLocale(day, "EEEE d MMMM"))}
                    </span>
                    {dayTasks.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {dayTasks.length}
                      </Badge>
                    )}
                  </div>
                  {dayTasks.length === 0 ? (
                    holidayMap.has(dayStr) ? (
                      <div className="ml-9 flex items-center gap-2">
                        <PartyPopper className="h-3.5 w-3.5 shrink-0" style={{ color: holidayMap.get(dayStr)!.color }} />
                        <p className="text-xs font-medium" style={{ color: holidayMap.get(dayStr)!.color }}>{holidayMap.get(dayStr)!.name}</p>
                      </div>
                    ) : (
                      <p className="ml-9 text-xs text-muted-foreground/60">{t("week.empty")}</p>
                    )
                  ) : (
                    <div className="ml-9 space-y-2">
                      {dayTasks.map((task) => (
                        <TaskCard
                          key={`${dayStr}-${task.id}`}
                          task={task}
                          collaborators={getCollaborators(task, dayStr)}
                          hasVehicle={hasVehicleForTask(task, dayStr)}
                          hasResource={hasResourceForTask(task, dayStr)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* --- Quick Link --- */}
      <Link href="/planning" className="block">
        <Button variant="outline" className="w-full gap-2">
          {t("viewFullPlanning")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}

// --- Week Pills ---

function WeekPills({
  weekPills,
  weekOffset,
  onSelect,
}: {
  weekPills: { offset: number; label: string; weekNum: number }[];
  weekOffset: number;
  onSelect: (offset: number) => void;
}) {
  const t = useTranslations("home");
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const scrollToActive = useCallback(() => {
    const container = scrollRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const scrollLeft =
      active.offsetLeft - container.offsetLeft - containerRect.width / 2 + activeRect.width / 2;
    container.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, []);

  // Scroll to active pill on mount and when weekOffset changes
  useEffect(() => {
    // Small delay to ensure pills are rendered
    requestAnimationFrame(scrollToActive);
  }, [weekOffset, scrollToActive]);

  return (
    <div className="mb-4 flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => onSelect(weekOffset - 1)}
        aria-label={t("week.previous")}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div
        ref={scrollRef}
        className="flex flex-1 gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {weekPills.map((pill) => (
          <button
            key={pill.offset}
            ref={pill.offset === weekOffset ? activeRef : undefined}
            onClick={() => onSelect(pill.offset)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
              pill.offset === weekOffset
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            )}
          >
            {t("weekPill", { week: pill.weekNum, range: pill.label })}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => onSelect(weekOffset + 1)}
        aria-label={t("week.next")}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// --- Notifications Carousel ---

function NotificationsCarousel() {
  const t = useTranslations("home");
  const notificationText = useNotificationText();
  const { formatRelative } = useDateFormat();
  const { data, isLoading } = useNotifications(1);
  const markAsRead = useMarkAsRead();
  const openTaskPreview = useTaskPreviewStore((s) => s.openPreview);

  const unreadNotifs = useMemo(
    () => (data?.data ?? []).filter((n) => !n.isRead),
    [data]
  );
  const unreadCount = data?.unreadCount ?? 0;

  function handleClick(notif: { id: string; type: string; isRead: boolean; actionUrl?: string | null }) {
    if (!notif.isRead) {
      markAsRead.mutate(notif.id);
    }
    if (TASK_NOTIFICATION_TYPES.has(notif.type) && notif.actionUrl) {
      const match = notif.actionUrl.match(/[?&]id=([^&]+)/);
      if (match) {
        openTaskPreview(match[1]);
      }
    }
  }

  if (!isLoading && unreadNotifs.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("notifications.title")}</h2>
        {unreadCount > 0 && (
          <Badge className="bg-primary text-primary-foreground text-xs">
            {unreadCount}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 min-w-[260px] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div
          className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {unreadNotifs.map((notif) => {
            const Icon = TYPE_ICONS[notif.type] ?? Bell;
            const colorClass = TYPE_COLORS[notif.type] ?? "bg-muted text-muted-foreground";
            const text = notificationText(notif);

            return (
              <button
                key={notif.id}
                onClick={() => handleClick(notif)}
                className="flex min-w-[260px] max-w-[300px] shrink-0 snap-start items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/50"
              >
                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", colorClass)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{text.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{text.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    {formatRelative(new Date(notif.createdAt))}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
