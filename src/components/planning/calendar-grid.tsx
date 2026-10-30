"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { addDays, format, isToday as isTodayFn, isWeekend } from "date-fns";
import { localizeDatePattern } from "@/i18n/date-locale";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { Loader2 } from "lucide-react";

import { usePlanningStore } from "@/stores/planning-store";
import { useBuStore } from "@/stores/bu-store";
import { usePlanningData } from "@/hooks/use-planning-data";
import { useHourConfig } from "@/hooks/use-hour-config";
import { dateSettingsFromConfig, formatHourLabel } from "@/lib/utils/dates";
import { useConfig } from "@/hooks/use-config";
import { useUsers } from "@/hooks/use-users";
import { usePermissions } from "@/hooks/use-permissions";
import { parseDailyTaskLimit, wouldExceedDailyLimit } from "@/lib/utils/daily-task-limit";
import { useMoveTask, useCopyTask, useDeleteTask, useRemoveUserFromTask, useResizeTask, useUpdateTask } from "@/hooks/use-tasks";
import { CalendarColumn } from "./calendar-column";
import { CalendarAllDayBlock } from "./calendar-allday-block";
import { CalendarDayTaskBlock } from "./calendar-day-task-block";
import { GridToolbar } from "./grid-toolbar";
import { GridDndContext, type DragCompleteInfo } from "./grid-dnd-context";
import { PlanningContextMenu, DropActionMenu, type ContextMenuState } from "./context-menu";
import { TaskFormDialog } from "./task-form-dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { RecurringDeleteDialog } from "./recurring-delete-dialog";
import type { TaskWithUsers } from "@/types";
import type { PlanningRow } from "@/lib/utils/sort-rows";
import { getContractSuffix } from "@/lib/constants/contract-types";
import { tDyn } from "@/i18n/dynamic";
// i18n-dynamic: users.contractTypes.*

const SLOT_HEIGHTS: Record<string, number> = {
  compact: 48,
  normal: 60,
  large: 80,
  xlarge: 100,
  xxlarge: 124,
};

function parseHourFromTime(timeStr: string): number {
  return parseInt(timeStr.split(":")[0], 10) || 0;
}

export function CalendarGrid() {
  const t = useTranslations("planning");
  const tUsers = useTranslations("users");
  const { dateLocale, locale } = useDateFormat();
  const {
    calendarMode, calendarDays, calendarUserId, startDate, selectedDay, zoomLevel,
    clipboardTask, setClipboard, clearClipboard, setPendingDrop,
    calendarShow24h, calendarPersonalView, dragOverCellId, markTaskDeleting,
  } = usePlanningStore();
  const { tasks, sortedRows, holidays, isLoading, error } = usePlanningData();
  const { slots: workSlots, isLoading: configLoading } = useHourConfig();
  const { data: config } = useConfig();
  const { userId: currentUserId, can, canCreateAnyTask, canCreateOnPlanningRow, canLockTask, canModifyTask, canDeleteTask, canMoveTask, modifyScope } = usePermissions();
  const dailyLimit = parseDailyTaskLimit(config?.PLANNING_MAX_TASKS_PER_DAY);

  // Mutations
  const moveTask = useMoveTask();
  const copyTask = useCopyTask();
  const deleteTaskMutation = useDeleteTask();
  const removeUserMutation = useRemoveUserFromTask();
  const resizeTask = useResizeTask();
  const updateTaskMutation = useUpdateTask();

  const isTeamDay = calendarMode === "team-day";
  const slotHeight = SLOT_HEIGHTS[zoomLevel] ?? 60;

  // Default time config
  const defaultStartTime = config?.AM_START || "08:00";
  const defaultEndTime = config?.PM_END || "17:00";

  // Work period hours for highlighting
  const workStartHour = parseHourFromTime(defaultStartTime);
  const workEndHour = parseHourFromTime(defaultEndTime);

  // Generate slots: all 24h or continuous work range based on toggle
  const timeFormat = dateSettingsFromConfig(config ?? {}).timeFormat;
  const all24Slots = useMemo(
    () => Array.from({ length: 24 }, (_, i) => ({ hour: i, label: formatHourLabel(i, locale, timeFormat), index: i })),
    [locale, timeFormat]
  );
  // Continuous range from first work hour to last work hour (no gaps)
  const workRangeSlots = useMemo(
    () => Array.from({ length: workEndHour - workStartHour }, (_, i) => ({
      hour: workStartHour + i,
      label: formatHourLabel(workStartHour + i, locale, timeFormat),
      index: i,
    })),
    [workStartHour, workEndHour, locale, timeFormat]
  );
  const activeSlots = calendarShow24h ? all24Slots : workRangeSlots;

  // Effective user (personal mode only)
  const effectiveUserId = calendarUserId || currentUserId;

  // ===== PERSONAL MODE: days as columns =====
  const days = useMemo(
    () => (isTeamDay ? [] : Array.from({ length: calendarDays }, (_, i) => addDays(startDate, i))),
    [isTeamDay, startDate, calendarDays]
  );

  // Filter tasks for selected user (personal mode)
  const userTasks = useMemo(() => {
    if (isTeamDay) return [];
    if (!effectiveUserId) return [];
    return tasks.filter((t) => t.users?.some((u) => u.id === effectiveUserId));
  }, [isTeamDay, tasks, effectiveUserId]);

  // Group tasks by day (personal mode)
  const tasksByDay = useMemo(() => {
    if (isTeamDay) return new Map<string, TaskWithUsers[]>();

    // Time-group helper matching Gantt slot-allocator sort order
    const timeGroup = (t: TaskWithUsers): number => {
      if (!t.startTime) return 0; // all-day → top
      if (t.startDate !== (t.endDate || t.startDate)) return 0; // multi-day
      const h = parseInt(t.startTime.split(":")[0], 10);
      const endH = t.endTime ? parseInt(t.endTime.split(":")[0], 10) : null;
      if (h < 12 && (endH === null || endH <= 12)) return 1; // morning
      if (h >= 12) return 2; // afternoon
      return 3;
    };

    const map = new Map<string, TaskWithUsers[]>();
    for (const day of days) {
      const dayStr = format(day, "yyyy-MM-dd");
      const filtered = userTasks.filter((t) => {
        const start = t.startDate;
        const end = t.endDate || t.startDate;
        return dayStr >= start && dayStr <= end;
      });
      // Sort matching Planning view: startDate → timeGroup → createdAt → endDate
      filtered.sort((a, b) => {
        const cmpDate = a.startDate.localeCompare(b.startDate);
        if (cmpDate !== 0) return cmpDate;
        const tg = timeGroup(a) - timeGroup(b);
        if (tg !== 0) return tg;
        const cmpC = (a.createdAt ? String(a.createdAt) : "").localeCompare(b.createdAt ? String(b.createdAt) : "");
        if (cmpC !== 0) return cmpC;
        return (a.endDate || a.startDate).localeCompare(b.endDate || b.startDate);
      });
      map.set(dayStr, filtered);
    }
    return map;
  }, [isTeamDay, days, userTasks]);

  // ===== TEAM-DAY MODE: always load users independently (not from viewMode rows) =====
  const { data: teamDayUsers } = useUsers(undefined, true);
  const { selectedBuIds } = useBuStore();
  const userRows = useMemo(() => {
    if (!isTeamDay || !teamDayUsers) return [];
    return (teamDayUsers as any[])
      .filter((u) => u.visibleOnPlanning)
      .filter((u) => selectedBuIds.length === 0 || (u.businessUnitId && selectedBuIds.includes(u.businessUnitId)))
      .map((u) => ({
        id: u.id,
        name: u.displayName || [u.firstName, u.name].filter(Boolean).join(" ") || u.name,
        type: "row" as const,
        color: u.color || "#6b7280",
        contractType: u.contractType ?? null,
        teamId: u.teamId,
        teamName: u.team?.name,
        teamColor: u.team?.color,
        sortOrder: u.sortOrder ?? 0,
      }));
  }, [isTeamDay, teamDayUsers, selectedBuIds]);

  const selectedDayStr = useMemo(() => format(selectedDay, "yyyy-MM-dd"), [selectedDay]);

  // Group tasks by user for the selected day
  const tasksByUser = useMemo(() => {
    if (!isTeamDay) return new Map<string, TaskWithUsers[]>();
    const map = new Map<string, TaskWithUsers[]>();
    for (const row of userRows) {
      map.set(
        row.id,
        tasks.filter((t) => {
          const start = t.startDate;
          const end = t.endDate || t.startDate;
          const isInDay = selectedDayStr >= start && selectedDayStr <= end;
          const isAssigned = t.users?.some((u) => u.id === row.id);
          return isInDay && isAssigned;
        })
      );
    }
    return map;
  }, [isTeamDay, tasks, userRows, selectedDayStr]);

  // All visible tasks (for delete / clipboard lookups)
  const allVisibleTasks = useMemo(() => {
    if (isTeamDay) {
      const all: TaskWithUsers[] = [];
      for (const arr of tasksByUser.values()) {
        for (const t of arr) {
          if (!all.some((x) => x.id === t.id)) all.push(t);
        }
      }
      return all;
    }
    const all: TaskWithUsers[] = [];
    for (const arr of tasksByDay.values()) {
      for (const t of arr) {
        if (!all.some((x) => x.id === t.id)) all.push(t);
      }
    }
    return all;
  }, [isTeamDay, tasksByUser, tasksByDay]);

  const handleLockTask = useCallback((taskId: string) => {
    const task = allVisibleTasks.find((t) => t.id === taskId);
    if (!task) return;
    updateTaskMutation.mutate({ id: taskId, data: { isLocked: !task.isLocked } });
  }, [allVisibleTasks, updateTaskMutation]);

  // Task form dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [prefillData, setPrefillData] = useState<{
    rowId?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Multi-user delete dialog state
  const [multiDeleteState, setMultiDeleteState] = useState<{ taskId: string; rowId: string } | null>(null);
  const [recurDeleteState, setRecurDeleteState] = useState<{ taskId: string; rowId?: string } | null>(null);
  const [pendingRecurScope, setPendingRecurScope] = useState<{ taskId: string; scope: "single" | "all" | "after" } | null>(null);

  // Drop action dialog state
  const [dropInfo, setDropInfo] = useState<DragCompleteInfo | null>(null);

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 1500);
  }, []);

  // Mouse position ref for keyboard shortcuts
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // --- Task handlers ---

  const handleTaskClick = useCallback((taskId: string) => {
    setEditingTaskId(taskId);
    setPrefillData(null);
    setDialogOpen(true);
  }, []);

  const handleCellClickPersonal = useCallback(
    (dateStr: string, hour: number) => {
      if (!canCreateAnyTask) return;
      const row = effectiveUserId ? sortedRows.find((r) => r.id === effectiveUserId) : null;
      if (row && row.type === "row" && !canCreateOnPlanningRow("users", row as { id: string; teamId?: string | null; ownerId?: string | null })) {
        return;
      }
      if (effectiveUserId && wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [effectiveUserId], startDate: dateStr })) {
        return;
      }
      setEditingTaskId(null);
      const startTime = `${String(hour).padStart(2, "0")}:00`;
      const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
      setPrefillData({
        rowId: effectiveUserId ?? undefined,
        date: dateStr,
        startTime,
        endTime,
      });
      setDialogOpen(true);
    },
    [effectiveUserId, canCreateAnyTask, canCreateOnPlanningRow, sortedRows, tasks, dailyLimit]
  );

  // Team-day: create a cell click handler per user
  const handleCellClickTeamDay = useCallback(
    (userId: string) => (dateStr: string, hour: number) => {
      if (!canCreateAnyTask) return;
      const row = sortedRows.find((r) => r.id === userId);
      if (row && row.type === "row" && !canCreateOnPlanningRow("users", row as { id: string; teamId?: string | null; ownerId?: string | null })) {
        return;
      }
      if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [userId], startDate: dateStr })) {
        return;
      }
      setEditingTaskId(null);
      const startTime = `${String(hour).padStart(2, "0")}:00`;
      const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
      setPrefillData({
        rowId: userId,
        date: dateStr,
        startTime,
        endTime,
      });
      setDialogOpen(true);
    },
    [canCreateAnyTask, canCreateOnPlanningRow, sortedRows, tasks, dailyLimit]
  );

  // Stable map of cell click handlers per user (team-day)
  const cellClickHandlers = useMemo(() => {
    if (!isTeamDay) return new Map<string, (dateStr: string, hour: number) => void>();
    const map = new Map<string, (dateStr: string, hour: number) => void>();
    for (const row of userRows) {
      map.set(row.id, handleCellClickTeamDay(row.id));
    }
    return map;
  }, [isTeamDay, userRows, handleCellClickTeamDay]);

  // --- Context menu handlers ---

  const handleTaskContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Find the rowId: in personal mode it's the effectiveUserId, in team-day find the column
    const rowId = isTeamDay
      ? (() => {
          for (const [uid, utasks] of tasksByUser.entries()) {
            if (utasks.some((t) => t.id === taskId)) return uid;
          }
          return undefined;
        })()
      : effectiveUserId ?? undefined;
    setContextMenu({ x: e.clientX, y: e.clientY, taskId, rowId });
  }, [isTeamDay, tasksByUser, effectiveUserId]);

  const handleCellContextMenuPersonal = useCallback((e: React.MouseEvent, dateStr: string, hour: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, rowId: effectiveUserId ?? undefined, dateStr, hour });
  }, [effectiveUserId]);

  const makeCellContextMenuTeamDay = useCallback((userId: string) => (e: React.MouseEvent, dateStr: string, hour: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, rowId: userId, dateStr, hour });
  }, []);

  const cellContextMenuHandlers = useMemo(() => {
    if (!isTeamDay) return new Map<string, (e: React.MouseEvent, dateStr: string, hour: number) => void>();
    const map = new Map<string, (e: React.MouseEvent, dateStr: string, hour: number) => void>();
    for (const row of userRows) {
      map.set(row.id, makeCellContextMenuTeamDay(row.id));
    }
    return map;
  }, [isTeamDay, userRows, makeCellContextMenuTeamDay]);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleEditTask = useCallback((taskId: string) => {
    setEditingTaskId(taskId);
    setPrefillData(null);
    setDialogOpen(true);
  }, []);

  const handleCopyToClipboard = useCallback((taskId: string) => {
    setClipboard(taskId, "copy");
  }, [setClipboard]);

  const handleCutToClipboard = useCallback((taskId: string) => {
    setClipboard(taskId, "cut");
  }, [setClipboard]);

  const handleDeleteTask = useCallback((taskId: string, rowId?: string) => {
    const task = allVisibleTasks.find((t) => t.id === taskId);
    if (task?.parentId) {
      setRecurDeleteState({ taskId, rowId });
    } else if (task && task.users?.length > 1 && rowId) {
      setMultiDeleteState({ taskId, rowId });
    } else {
      markTaskDeleting(taskId);
      setTimeout(() => deleteTaskMutation.mutate({ id: taskId }), 170);
    }
  }, [deleteTaskMutation, allVisibleTasks, markTaskDeleting]);

  const handleCreateTask = useCallback((rowId: string, cellDateStr: string) => {
    setEditingTaskId(null);
    setPrefillData({ rowId, date: cellDateStr });
    setDialogOpen(true);
  }, []);

  const handlePaste = useCallback((rowId: string, cellDateStr: string, hour?: number) => {
    if (!clipboardTask) return;

    const rowFieldData: Record<string, unknown> = { userIds: [rowId] };

    const task = allVisibleTasks.find((t) => t.id === clipboardTask.taskId);

    // Compute new startTime/endTime if pasting on an hour cell
    let timeData: Record<string, string> = {};
    if (hour != null && task) {
      const origStartH = task.startTime ? parseInt(task.startTime.split(":")[0], 10) : null;
      const origEndH = task.endTime ? parseInt(task.endTime.split(":")[0], 10) : null;
      const duration = origStartH != null && origEndH != null ? origEndH - origStartH : 1;
      const newStartTime = `${String(hour).padStart(2, "0")}:00`;
      const newEndTime = `${String(hour + Math.max(duration, 1)).padStart(2, "0")}:00`;
      timeData = { startTime: newStartTime, endTime: newEndTime };
    }

    if (clipboardTask.mode === "copy") {
      copyTask.mutate({
        id: clipboardTask.taskId,
        data: { startDate: cellDateStr, ...rowFieldData, ...timeData },
      });
    } else {
      const moveData: Record<string, unknown> = { startDate: cellDateStr, ...rowFieldData, ...timeData };
      if (task?.endDate) {
        const diffDays = Math.round(
          (new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000
        );
        const newEnd = new Date(cellDateStr);
        newEnd.setDate(newEnd.getDate() + diffDays);
        moveData.endDate = newEnd.toISOString().slice(0, 10);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      moveTask.mutate({ id: clipboardTask.taskId, data: moveData as any });
      clearClipboard();
    }
  }, [clipboardTask, copyTask, moveTask, allVisibleTasks, clearClipboard]);

  // --- Resize handler ---
  const handleCalendarResize = useCallback((taskId: string, startTime: string, endTime: string) => {
    const task = allVisibleTasks.find((t) => t.id === taskId);
    resizeTask.mutate({
      id: taskId,
      data: {
        endDate: task?.endDate ?? task?.startDate ?? selectedDayStr,
        startTime,
        endTime,
      },
    });
  }, [resizeTask, allVisibleTasks, selectedDayStr]);

  // --- Keyboard shortcuts (Ctrl/Cmd + C/X/V) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const { x, y } = mousePosRef.current;
      const els = document.elementsFromPoint(x, y);

      if (key === "c" || key === "x") {
        const taskEl = els.find((el) => (el as HTMLElement).dataset?.taskId);
        if (!taskEl) return;
        const taskId = (taskEl as HTMLElement).dataset.taskId!;
        const taskForCut = allVisibleTasks.find((t) => t.id === taskId);
        if (key === "c" && !canCreateAnyTask) return;
        if (key === "x" && (!taskForCut || taskForCut.isLocked || !canMoveTask(taskForCut))) return;
        e.preventDefault();
        setClipboard(taskId, key === "c" ? "copy" : "cut");
        const label = taskForCut?.title || t("grid.taskFallback");
        showToast(key === "c" ? t("grid.clipboard.copied", { title: label }) : t("grid.clipboard.cut", { title: label }));
      } else if (key === "v") {
        if (!clipboardTask) return;
        if (clipboardTask.mode === "copy" && !canCreateAnyTask) return;
        if (clipboardTask.mode === "cut") {
          const source = allVisibleTasks.find((t) => t.id === clipboardTask.taskId);
          if (!source || !canMoveTask(source)) return;
        }
        const cellEl = els.find((el) => (el as HTMLElement).dataset?.cellId);
        if (!cellEl) return;
        const cellId = (cellEl as HTMLElement).dataset.cellId!;
        const parts = cellId.split(":");
        const rowId = parts[0];
        const cellDateStr = parts[1];
        const hourPart = parts[2];
        const hour = hourPart != null && hourPart !== "allday" ? parseInt(hourPart, 10) : undefined;
        if (!rowId || !cellDateStr) return;
        // Destination: always "users" in calendar view, check the row
        // (team-day) or the current user (personal) through canCreateOnPlanningRow.
        const destRow = sortedRows.find((r) => r.id === rowId);
        if (destRow && destRow.type === "row" && !canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null })) return;
        e.preventDefault();
        handlePaste(rowId, cellDateStr, isNaN(hour as number) ? undefined : hour);
        showToast(clipboardTask.mode === "copy" ? t("grid.clipboard.pastedCopy") : t("grid.clipboard.pastedMove"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clipboardTask, setClipboard, handlePaste, allVisibleTasks, showToast, can, canCreateAnyTask, canMoveTask, t]);

  // --- Drag & Drop ---
  const handleDragComplete = useCallback((info: DragCompleteInfo) => {
    setDropInfo(info);
    setPendingDrop({
      taskId: info.taskId,
      newStartDate: info.newStartDate,
      newEndDate: info.newEndDate,
      newStartTime: info.newStartTime,
      newEndTime: info.newEndTime,
      targetRowId: info.targetRowId,
    });
  }, [setPendingDrop]);

  const clearDrop = useCallback(() => {
    setDropInfo(null);
    setPendingDrop(null);
  }, [setPendingDrop]);

  const handleDropMove = useCallback(() => {
    if (!dropInfo) return;
    const task = allVisibleTasks.find((t) => t.id === dropInfo.taskId);
    const isMultiUser = (task?.users?.length ?? 0) > 1;
    moveTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dropInfo.newStartDate,
        endDate: dropInfo.newEndDate,
        ...(dropInfo.newStartTime ? { startTime: dropInfo.newStartTime } : {}),
        ...(dropInfo.newEndTime ? { endTime: dropInfo.newEndTime } : {}),
        ...(isMultiUser ? {} : (dropInfo.targetRowId ? { userIds: [dropInfo.targetRowId] } : {})),
      },
    });
    clearDrop();
  }, [dropInfo, moveTask, clearDrop, allVisibleTasks]);

  const handleDropCopy = useCallback(() => {
    if (!dropInfo) return;
    copyTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dropInfo.newStartDate,
        ...(dropInfo.newStartTime ? { startTime: dropInfo.newStartTime } : {}),
        ...(dropInfo.newEndTime ? { endTime: dropInfo.newEndTime } : {}),
        ...(dropInfo.targetRowId ? { userIds: [dropInfo.targetRowId] } : {}),
      },
    });
    clearDrop();
  }, [dropInfo, copyTask, clearDrop]);

  const handleDropMoveUser = useCallback(() => {
    if (!dropInfo || !dropInfo.sourceRowId) return;
    const sourceUserId = dropInfo.sourceRowId;
    removeUserMutation.mutate({ taskId: dropInfo.taskId, userId: sourceUserId });
    copyTask.mutate({
      id: dropInfo.taskId,
      data: { startDate: dropInfo.newStartDate, userIds: [sourceUserId] },
    });
    clearDrop();
  }, [dropInfo, removeUserMutation, copyTask, clearDrop]);

  // Scroll container ref (for scroll-to-now)
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Scroll to current hour on mount if today is visible
  useEffect(() => {
    if (hasScrolledRef.current) return;
    const todayVisible = isTeamDay
      ? isTodayFn(selectedDay)
      : days.some((d) => isTodayFn(d));
    if (!todayVisible || !scrollRef.current) return;

    const now = new Date();
    const currentHour = now.getHours();
    const scrollTarget = Math.max(0, (currentHour - 1)) * slotHeight;
    scrollRef.current.scrollTop = scrollTarget;
    hasScrolledRef.current = true;
  }, [isTeamDay, selectedDay, days, slotHeight]);

  // Check if there are tasks to display (for empty state)
  const hasVisibleTasks = isTeamDay
    ? Array.from(tasksByUser.values()).some((t) => t.length > 0)
    : Array.from(tasksByDay.values()).some((t) => t.length > 0);

  const handleCreateTaskButton = useCallback(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    setEditingTaskId(null);
    setPrefillData({
      rowId: isTeamDay ? undefined : (effectiveUserId ?? undefined),
      date: isTeamDay ? selectedDayStr : today,
    });
    setDialogOpen(true);
  }, [isTeamDay, effectiveUserId, selectedDayStr]);

  if (isLoading || configLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {t("canvas.loadError", { message: (error as Error).message })}
      </div>
    );
  }

  const totalHeight = activeSlots.length * slotHeight;

  // ===== TEAM-DAY RENDER =====
  if (isTeamDay) {
    const columnCount = userRows.length;
    const isSelectedToday = isTodayFn(selectedDay);
    const holiday = holidays.get(selectedDayStr) ?? null;
    const dateLabel = format(selectedDay, localizeDatePattern("EEEE d MMMM yyyy", locale), { locale: dateLocale });

    return (
      <div className="flex h-full flex-col">
        <GridToolbar onCreateTask={handleCreateTaskButton} />

        <GridDndContext tasks={allVisibleTasks} onDragComplete={handleDragComplete}>
          <div ref={scrollRef} className="flex-1 overflow-auto">
            {/* Date header */}
            <div
              className={`sticky top-0 z-20 border-b px-4 py-2 text-center text-base font-semibold first-letter:uppercase backdrop-blur ${
                isSelectedToday
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/80 text-foreground"
              }`}
            >
              {dateLabel}
              {holiday && (
                <span
                  className="ml-2 text-xs font-normal"
                  style={{ color: holiday.color }}
                >
                  ({holiday.label})
                </span>
              )}
            </div>

            {columnCount === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                {t("grid.noVisibleUsers")}
              </div>
            ) : (
              <div className="relative">
                {/* Empty state overlay */}
                <div
                  className="inline-grid min-w-full"
                  style={{
                    gridTemplateColumns: `60px repeat(${columnCount}, minmax(max-content, 1fr))`,
                  }}
                >
                {/* ---- User name headers (sticky below date) ---- */}
                <div className="sticky top-[41px] z-10 border-b border-r border-border bg-muted/80 backdrop-blur" />
                {userRows.map((row) => {
                  const planningRow = row as PlanningRow;
                  return (
                    <div
                      key={row.id}
                      className="sticky top-[41px] z-10 flex flex-col items-center justify-center gap-0.5 border-b border-r border-border bg-muted/80 px-2 py-1.5 backdrop-blur overflow-hidden"
                    >
                      <div className="flex items-center gap-1.5 max-w-full min-w-0">
                        {/* Color dot */}
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: (row as { color?: string }).color || "#6b7280",
                          }}
                        />
                        <span className="truncate text-sm font-medium text-foreground">
                          {(() => {
                            const suffix = getContractSuffix(
                              (row as { contractType?: string | null }).contractType,
                              (key) => tDyn(tUsers, `contractTypes.${key}`),
                            );
                            return suffix ? `${row.name} [${suffix}]` : row.name;
                          })()}
                        </span>
                      </div>
                      {planningRow.teamName && (
                        <span className="truncate max-w-full text-[10px] text-muted-foreground">
                          {planningRow.teamName}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* ---- All-day row (Outlook style) ---- */}
                {(() => {
                  const allDayByUser = new Map<string, TaskWithUsers[]>();
                  const timedByUser = new Map<string, TaskWithUsers[]>();
                  let hasAnyAllDay = false;
                  for (const row of userRows) {
                    const rowTasks = tasksByUser.get(row.id) ?? [];
                    const allDay = rowTasks.filter((t) => !t.startTime);
                    const timed = rowTasks.filter((t) => !!t.startTime);
                    allDayByUser.set(row.id, allDay);
                    timedByUser.set(row.id, timed);
                    if (allDay.length > 0) hasAnyAllDay = true;
                  }
                  const maxAllDay = Math.max(...Array.from(allDayByUser.values()).map((a) => a.length), 0);
                  const allDayRowHeight = Math.max(maxAllDay * 26 + 8, 34);

                  return (
                    <>
                          <div
                            className="border-b border-r border-border bg-muted/30 flex items-center justify-end pr-2 text-[10px] text-muted-foreground"
                            style={{ height: allDayRowHeight }}
                          >
                            {t("grid.allDay")}
                          </div>
                          {userRows.map((row) => {
                            const allDayTasks = allDayByUser.get(row.id) ?? [];
                            return (
                              <div
                                key={`allday-${row.id}`}
                                data-cell-id={`${row.id}:${selectedDayStr}:allday`}
                                className={`border-b border-r border-border p-0.5 transition-colors duration-100 hover:bg-primary/5 ${dragOverCellId === `${row.id}:${selectedDayStr}:allday` ? "ring-2 ring-inset ring-primary/40 !bg-primary/10" : ""}`}
                                style={{ height: allDayRowHeight }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setContextMenu({ x: e.clientX, y: e.clientY, rowId: row.id, dateStr: selectedDayStr });
                                }}
                                onClick={() => {
                                  setEditingTaskId(null);
                                  setPrefillData({ rowId: row.id, date: selectedDayStr });
                                  setDialogOpen(true);
                                }}
                              >
                                <div className="flex flex-col gap-0.5 overflow-hidden">
                                  {allDayTasks.map((task) => (
                                    <CalendarAllDayBlock
                                      key={task.id}
                                      task={task}
                                      columnId={row.id}
                                      onClick={handleTaskClick}
                                      onContextMenu={handleTaskContextMenu}
                                    />
                                  ))}
                                </div>
                              </div>
                            );
                          })}

                      {/* ---- Body: hour labels + user columns (timed only) ---- */}
                      <div
                        className="relative border-r border-border bg-muted/30"
                        style={{ height: totalHeight }}
                      >
                        {activeSlots.map((slot, i) => {
                          const isOutsideWork = slot.hour < workStartHour || slot.hour >= workEndHour;
                          return (
                            <div
                              key={slot.hour}
                              className="absolute right-0 left-0 border-b border-border/50"
                              style={{
                                top: i * slotHeight,
                                height: slotHeight,
                                backgroundColor: isOutsideWork ? "color-mix(in srgb, var(--color-muted) 20%, transparent)" : undefined,
                              }}
                            >
                              <span className="absolute right-2 text-xs text-muted-foreground" style={{ top: 2 }}>
                                {slot.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {userRows.map((row) => {
                        const rowTasks = timedByUser.get(row.id) ?? [];
                        return (
                          <CalendarColumn
                            key={row.id}
                            tasks={rowTasks}
                            slots={activeSlots}
                            slotHeight={slotHeight}
                            dateStr={selectedDayStr}
                            isToday={isSelectedToday}
                            isHoliday={holiday}
                            onTaskClick={handleTaskClick}
                            onCellClick={cellClickHandlers.get(row.id) ?? handleCellClickPersonal}
                            onTaskContextMenu={handleTaskContextMenu}
                            onCellContextMenu={cellContextMenuHandlers.get(row.id)}
                            defaultStartTime={defaultStartTime}
                            defaultEndTime={defaultEndTime}
                            workStartHour={workStartHour}
                            workEndHour={workEndHour}
                            columnId={row.id}
                            onResize={handleCalendarResize}
                          />
                        );
                      })}
                    </>
                  );
                })()}
                </div>
              </div>
            )}
          </div>
        </GridDndContext>

        {/* Context menu */}
        <PlanningContextMenu
          state={contextMenu}
          onClose={handleCloseContextMenu}
          hasClipboard={!!clipboardTask}
          isMultiUser={contextMenu?.taskId ? (allVisibleTasks.find((t) => t.id === contextMenu.taskId)?.users?.length ?? 0) > 1 : false}
          isRecurring={contextMenu?.taskId ? !!allVisibleTasks.find((t) => t.id === contextMenu.taskId)?.parentId : false}
          canCreate={canCreateAnyTask && (() => {
            const rowId = contextMenu?.rowId;
            const dateStr = contextMenu?.dateStr;
            if (rowId && dateStr && wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [rowId], startDate: dateStr })) {
              return false;
            }
            return true;
          })()}
          canEdit={(() => {
            const t = contextMenu?.taskId ? allVisibleTasks.find((t) => t.id === contextMenu.taskId) : null;
            if (t?.isLocked) return false;
            return t ? canModifyTask(t) : modifyScope !== "readonly";
          })()}
          canCopy={canCreateAnyTask}
          canCut={(() => {
            if (!contextMenu?.taskId) return can("tasks:move");
            const t = allVisibleTasks.find((t) => t.id === contextMenu.taskId);
            if (!t || t.isLocked) return false;
            return canMoveTask(t);
          })()}
          canDelete={(() => {
            if (!contextMenu?.taskId) return can("tasks:delete");
            const t = allVisibleTasks.find((t) => t.id === contextMenu.taskId);
            if (!t || t.isLocked) return false;
            return canDeleteTask(t);
          })()}
          canPaste={(() => {
            if (!clipboardTask) return false;
            if (clipboardTask.mode === "copy") {
              if (!canCreateAnyTask) return false;
            } else {
              const source = allVisibleTasks.find((t) => t.id === clipboardTask.taskId);
              if (!source || !canMoveTask(source)) return false;
            }
            if (!contextMenu?.rowId) return true;
            const destRow = sortedRows.find(r => r.id === contextMenu.rowId);
            if (!destRow || destRow.type !== "row") return true;
            return canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null });
          })()}
          canLock={contextMenu?.taskId ? (() => { const t = allVisibleTasks.find(t => t.id === contextMenu.taskId); return t ? canLockTask(t) : false; })() : false}
          isLocked={contextMenu?.taskId ? allVisibleTasks.find(t => t.id === contextMenu.taskId)?.isLocked === true : false}
          onEditTask={handleEditTask}
          onCopyTask={handleCopyToClipboard}
          onCutTask={handleCutToClipboard}
          onDeleteTask={handleDeleteTask}
          onLockTask={handleLockTask}
          onCreateTask={handleCreateTask}
          onPaste={handlePaste}
        />

        <TaskFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          taskId={editingTaskId}
          prefill={prefillData}
          viewMode="users"
        />

        {/* Multi-user delete dialog */}
        <DeleteConfirmDialog
          open={!!multiDeleteState}
          onOpenChange={(open) => { if (!open) { setMultiDeleteState(null); setPendingRecurScope(null); } }}
          title={t("canvas.multiDelete.title")}
          description={t("canvas.multiDelete.description", { count: allVisibleTasks.find((x) => x.id === multiDeleteState?.taskId)?.users?.length ?? 0 })}
          onConfirm={() => {
            if (multiDeleteState) {
              const scope = pendingRecurScope?.scope;
              markTaskDeleting(multiDeleteState.taskId);
              setMultiDeleteState(null);
              setPendingRecurScope(null);
              setTimeout(() => deleteTaskMutation.mutate({ id: multiDeleteState.taskId, scope }), 170);
            }
          }}
          onArchive={() => {
            if (multiDeleteState) {
              removeUserMutation.mutate({
                taskId: multiDeleteState.taskId,
                userId: multiDeleteState.rowId,
                scope: pendingRecurScope?.scope,
              });
              setMultiDeleteState(null);
              setPendingRecurScope(null);
            }
          }}
          confirmLabel={t("canvas.multiDelete.confirm")}
          archiveLabel={t("canvas.multiDelete.archive")}
        />

        {/* Recurring delete dialog */}
        <RecurringDeleteDialog
          open={!!recurDeleteState}
          onOpenChange={(open) => { if (!open) setRecurDeleteState(null); }}
          onDelete={(scope) => {
            if (!recurDeleteState) return;
            const task = allVisibleTasks.find((t) => t.id === recurDeleteState.taskId);
            const isMulti = (task?.users?.length ?? 0) > 1;
            const rowId = recurDeleteState.rowId;
            if (isMulti && rowId) {
              setPendingRecurScope({ taskId: recurDeleteState.taskId, scope });
              setMultiDeleteState({ taskId: recurDeleteState.taskId, rowId });
              setRecurDeleteState(null);
            } else {
              markTaskDeleting(recurDeleteState.taskId);
              setRecurDeleteState(null);
              setTimeout(() => deleteTaskMutation.mutate({ id: recurDeleteState.taskId, scope }), 170);
            }
          }}
        />

        {/* Drop action menu */}
        <DropActionMenu
          position={dropInfo?.dropPosition ?? null}
          isMultiUser={dropInfo ? ((allVisibleTasks.find((t) => t.id === dropInfo.taskId)?.users?.length ?? 0) > 1) : false}
          canMove={(() => {
            const src = dropInfo ? allVisibleTasks.find(t => t.id === dropInfo.taskId) : null;
            if (!src || !canMoveTask(src)) return false;
            if (!dropInfo?.targetRowId) return true;
            const destRow = sortedRows.find(r => r.id === dropInfo.targetRowId);
            if (!destRow || destRow.type !== "row") return true;
            return canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null });
          })()}
          canCopy={(() => {
            if (!canCreateAnyTask) return false;
            if (!dropInfo?.targetRowId) return true;
            const destRow = sortedRows.find(r => r.id === dropInfo.targetRowId);
            if (!destRow || destRow.type !== "row") return true;
            return canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null });
          })()}
          onClose={clearDrop}
          onMove={handleDropMove}
          onMoveUser={handleDropMoveUser}
          onCopy={handleDropCopy}
        />

        {/* Keyboard shortcut toast */}
        {toastMsg && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
            {toastMsg}
          </div>
        )}
      </div>
    );
  }

  // Column width: fixed when many days to allow horizontal scroll
  const personalColWidth = calendarDays <= 7 ? "1fr" : "180px";
  const isDaysView = calendarPersonalView === "days";

  // ===== PERSONAL MODE RENDER =====
  return (
    <div className="flex h-full flex-col">
      <GridToolbar onCreateTask={handleCreateTaskButton} />

      <GridDndContext tasks={allVisibleTasks} onDragComplete={handleDragComplete}>
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {/* Empty state overlay */}
          <div className="relative">

            {isDaysView ? (
              /* ===== DAYS VIEW (no hours, compact cards) ===== */
              <div
                className="inline-grid min-w-full"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(days.length, 7)}, minmax(160px, 1fr))`,
                }}
              >
                {days.map((day) => {
                  const dayStr = format(day, "yyyy-MM-dd");
                  const today = isTodayFn(day);
                  const holiday = holidays.get(dayStr) ?? null;
                  const dayTasks = tasksByDay.get(dayStr) ?? [];

                  return (
                    <div
                      key={dayStr}
                      data-cell-id={`${effectiveUserId}:${dayStr}`}
                      className={`border-r border-border min-h-[200px] transition-colors duration-100 ${
                        dragOverCellId === `${effectiveUserId}:${dayStr}` ? "ring-2 ring-inset ring-primary/40 !bg-primary/10" :
                        today ? "bg-primary/5" : isWeekend(day) ? "bg-muted/30" : ""
                      }`}
                    >
                      {/* Day header */}
                      <div
                        className={`sticky top-0 z-10 border-b px-2 py-1.5 text-center backdrop-blur ${
                          today
                            ? "bg-primary/10 text-primary"
                            : isWeekend(day)
                              ? "bg-muted/90 text-muted-foreground"
                              : "bg-muted/80 text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 text-sm font-medium capitalize">
                          <span>{format(day, "EEE", { locale: dateLocale })}</span>
                          {today ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                              {format(day, "d")}
                            </span>
                          ) : (
                            <span>{format(day, "d")}</span>
                          )}
                        </div>
                        <div className="text-[10px] capitalize text-muted-foreground">
                          {format(day, "MMMM", { locale: dateLocale })}
                          {holiday && (
                            <span className="ml-1" style={{ color: holiday.color }}>
                              · {holiday.label}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Task list */}
                      <div className="space-y-1 p-1.5">
                        {dayTasks.length === 0 && (
                          <div
                            className="flex h-16 cursor-pointer items-center justify-center rounded border border-dashed border-border/50 text-xs text-muted-foreground hover:border-border hover:bg-muted/20 transition-colors"
                            onClick={() => handleCellClickPersonal(dayStr, workStartHour)}
                          >
                            +
                          </div>
                        )}
                        {dayTasks.map((task) => (
                          <CalendarDayTaskBlock
                            key={task.id}
                            task={task}
                            columnId={effectiveUserId ?? ""}
                            onClick={handleTaskClick}
                            onContextMenu={handleTaskContextMenu}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ===== HOURS VIEW (existing) ===== */
              (() => {
                // Separate all-day tasks from timed tasks per day
                const allDayByDay = new Map<string, TaskWithUsers[]>();
                const timedByDay = new Map<string, TaskWithUsers[]>();
                let hasAnyAllDay = false;
                for (const day of days) {
                  const dayStr = format(day, "yyyy-MM-dd");
                  const dayTasks = tasksByDay.get(dayStr) ?? [];
                  const allDay = dayTasks.filter((t) => !t.startTime);
                  const timed = dayTasks.filter((t) => !!t.startTime);
                  allDayByDay.set(dayStr, allDay);
                  timedByDay.set(dayStr, timed);
                  if (allDay.length > 0) hasAnyAllDay = true;
                }
                const maxAllDay = Math.max(...Array.from(allDayByDay.values()).map((a) => a.length), 0);
                const allDayRowHeight = Math.max(maxAllDay * 26 + 8, 34);

                return (
                  <div
                    className="inline-grid"
                    style={{
                      gridTemplateColumns: `60px repeat(${days.length}, ${personalColWidth})`,
                      minWidth: calendarDays <= 7 ? "100%" : undefined,
                    }}
                  >
                    {/* ---- Header row (sticky) ---- */}
                    <div className="sticky top-0 z-10 border-b border-r border-border bg-muted/80 backdrop-blur" />
                    {days.map((day) => {
                      const dayStr = format(day, "yyyy-MM-dd");
                      const today = isTodayFn(day);
                      const dayOfWeek = format(day, "EEE", { locale: dateLocale });
                      const dayNum = format(day, "d");
                      const monthName = format(day, "MMM", { locale: dateLocale });
                      return (
                        <div
                          key={dayStr}
                          className={`sticky top-0 z-10 border-b border-r border-border px-2 py-1 text-center backdrop-blur ${
                            today
                              ? "bg-primary/10 text-primary"
                              : isWeekend(day)
                                ? "bg-muted/90 text-muted-foreground"
                                : "bg-muted/80 text-muted-foreground"
                          }`}
                        >
                          <div className="flex items-center justify-center gap-1 text-sm font-medium capitalize">
                            <span>{dayOfWeek}</span>
                            {today ? (
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                                {dayNum}
                              </span>
                            ) : (
                              <span>{dayNum}</span>
                            )}
                          </div>
                          <div className="text-[10px] capitalize text-muted-foreground">{monthName}</div>
                        </div>
                      );
                    })}

                    {/* ---- All-day row (Outlook style) ---- */}
                        <div
                          className="border-b border-r border-border bg-muted/30 flex items-center justify-end pr-2 text-[10px] text-muted-foreground"
                          style={{ height: allDayRowHeight }}
                        >
                          {t("grid.allDay")}
                        </div>
                        {days.map((day) => {
                          const dayStr = format(day, "yyyy-MM-dd");
                          const allDayTasks = allDayByDay.get(dayStr) ?? [];
                          const today = isTodayFn(day);
                          return (
                            <div
                              key={`allday-${dayStr}`}
                              data-cell-id={`${effectiveUserId}:${dayStr}:allday`}
                              className={`border-b border-r border-border p-0.5 transition-colors duration-100 hover:bg-primary/5 ${dragOverCellId === `${effectiveUserId}:${dayStr}:allday` ? "ring-2 ring-inset ring-primary/40 !bg-primary/10" : ""}`}
                              style={{
                                height: allDayRowHeight,
                                backgroundColor: dragOverCellId === `${effectiveUserId}:${dayStr}:allday` ? undefined : today ? "color-mix(in oklch, var(--primary) 7%, transparent)" : isWeekend(day) ? "color-mix(in srgb, var(--color-muted) 30%, transparent)" : undefined,
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, rowId: effectiveUserId ?? undefined, dateStr: dayStr });
                              }}
                              onClick={() => {
                                setEditingTaskId(null);
                                setPrefillData({ rowId: effectiveUserId ?? undefined, date: dayStr });
                                setDialogOpen(true);
                              }}
                            >
                              <div className="flex flex-col gap-0.5 overflow-hidden">
                                {allDayTasks.map((task) => (
                                  <CalendarAllDayBlock
                                    key={task.id}
                                    task={task}
                                    columnId={effectiveUserId ?? dayStr}
                                    onClick={handleTaskClick}
                                    onContextMenu={handleTaskContextMenu}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}

                    {/* ---- Body: hour labels + columns ---- */}
                    {/* Hour labels column */}
                    <div className="relative border-r border-border bg-muted/30" style={{ height: totalHeight }}>
                      {activeSlots.map((slot, i) => {
                        const isOutsideWork = slot.hour < workStartHour || slot.hour >= workEndHour;
                        return (
                          <div
                            key={slot.hour}
                            className="absolute right-0 left-0 border-b border-border/50"
                            style={{
                              top: i * slotHeight,
                              height: slotHeight,
                              backgroundColor: isOutsideWork ? "color-mix(in srgb, var(--color-muted) 20%, transparent)" : undefined,
                            }}
                          >
                            <span className="absolute right-2 text-xs text-muted-foreground" style={{ top: 2 }}>
                              {slot.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Day columns (only timed tasks) */}
                    {days.map((day) => {
                      const dayStr = format(day, "yyyy-MM-dd");
                      const dayTasks = timedByDay.get(dayStr) ?? [];
                      const holiday = holidays.get(dayStr) ?? null;

                      return (
                        <CalendarColumn
                          key={dayStr}
                          tasks={dayTasks}
                          slots={activeSlots}
                          slotHeight={slotHeight}
                          dateStr={dayStr}
                          isToday={isTodayFn(day)}
                          isWeekendDay={isWeekend(day)}
                          isHoliday={holiday}
                          onTaskClick={handleTaskClick}
                          onCellClick={handleCellClickPersonal}
                          onTaskContextMenu={handleTaskContextMenu}
                          onCellContextMenu={handleCellContextMenuPersonal}
                          defaultStartTime={defaultStartTime}
                          defaultEndTime={defaultEndTime}
                          workStartHour={workStartHour}
                          workEndHour={workEndHour}
                          columnId={effectiveUserId ?? dayStr}
                          onResize={handleCalendarResize}
                        />
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </GridDndContext>

      {/* Context menu */}
      <PlanningContextMenu
        state={contextMenu}
        onClose={handleCloseContextMenu}
        hasClipboard={!!clipboardTask}
        isMultiUser={contextMenu?.taskId ? (allVisibleTasks.find((t) => t.id === contextMenu.taskId)?.users?.length ?? 0) > 1 : false}
        isRecurring={contextMenu?.taskId ? !!allVisibleTasks.find((t) => t.id === contextMenu.taskId)?.parentId : false}
        canCreate={canCreateAnyTask}
        canEdit={(() => {
          const t = contextMenu?.taskId ? allVisibleTasks.find((t) => t.id === contextMenu.taskId) : null;
          if (t?.isLocked) return false;
          return t ? canModifyTask(t) : modifyScope !== "readonly";
        })()}
        canCopy={canCreateAnyTask}
        canCut={(() => {
          if (!contextMenu?.taskId) return can("tasks:move");
          const t = allVisibleTasks.find((t) => t.id === contextMenu.taskId);
          if (!t || t.isLocked) return false;
          return canMoveTask(t);
        })()}
        canDelete={(() => {
          if (!contextMenu?.taskId) return can("tasks:delete");
          const t = allVisibleTasks.find((t) => t.id === contextMenu.taskId);
          if (!t || t.isLocked) return false;
          return canDeleteTask(t);
        })()}
        canPaste={(() => {
          if (!clipboardTask) return false;
          if (clipboardTask.mode === "copy") {
            if (!canCreateAnyTask) return false;
          } else {
            const source = allVisibleTasks.find((t) => t.id === clipboardTask.taskId);
            if (!source || !canMoveTask(source)) return false;
          }
          // Personal view: the destination is always the current user,
          // so check the selected row if it is known.
          if (!contextMenu?.rowId) return true;
          const destRow = sortedRows.find(r => r.id === contextMenu.rowId);
          if (!destRow || destRow.type !== "row") return true;
          return canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null });
        })()}
        canLock={contextMenu?.taskId ? (() => { const t = allVisibleTasks.find(t => t.id === contextMenu.taskId); return t ? canLockTask(t) : false; })() : false}
        isLocked={contextMenu?.taskId ? allVisibleTasks.find(t => t.id === contextMenu.taskId)?.isLocked === true : false}
        onEditTask={handleEditTask}
        onCopyTask={handleCopyToClipboard}
        onCutTask={handleCutToClipboard}
        onDeleteTask={handleDeleteTask}
        onLockTask={handleLockTask}
        onCreateTask={handleCreateTask}
        onPaste={handlePaste}
      />

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        taskId={editingTaskId}
        prefill={prefillData}
        viewMode="users"
      />

      {/* Multi-user delete dialog */}
      <DeleteConfirmDialog
        open={!!multiDeleteState}
        onOpenChange={(open) => { if (!open) { setMultiDeleteState(null); setPendingRecurScope(null); } }}
        title={t("canvas.multiDelete.title")}
        description={t("canvas.multiDelete.description", { count: allVisibleTasks.find((x) => x.id === multiDeleteState?.taskId)?.users?.length ?? 0 })}
        onConfirm={() => {
          if (multiDeleteState) {
            const scope = pendingRecurScope?.scope;
            markTaskDeleting(multiDeleteState.taskId);
            setMultiDeleteState(null);
            setPendingRecurScope(null);
            setTimeout(() => deleteTaskMutation.mutate({ id: multiDeleteState.taskId, scope }), 170);
          }
        }}
        onArchive={() => {
          if (multiDeleteState) {
            removeUserMutation.mutate({
              taskId: multiDeleteState.taskId,
              userId: multiDeleteState.rowId,
              scope: pendingRecurScope?.scope,
            });
            setMultiDeleteState(null);
            setPendingRecurScope(null);
          }
        }}
        confirmLabel={t("canvas.multiDelete.confirm")}
        archiveLabel={t("canvas.multiDelete.archive")}
      />

      {/* Recurring delete dialog */}
      <RecurringDeleteDialog
        open={!!recurDeleteState}
        onOpenChange={(open) => { if (!open) setRecurDeleteState(null); }}
        onDelete={(scope) => {
          if (!recurDeleteState) return;
          const task = allVisibleTasks.find((t) => t.id === recurDeleteState.taskId);
          const isMulti = (task?.users?.length ?? 0) > 1;
          const rowId = recurDeleteState.rowId;
          if (isMulti && rowId) {
            setPendingRecurScope({ taskId: recurDeleteState.taskId, scope });
            setMultiDeleteState({ taskId: recurDeleteState.taskId, rowId });
            setRecurDeleteState(null);
          } else {
            markTaskDeleting(recurDeleteState.taskId);
            setRecurDeleteState(null);
            setTimeout(() => deleteTaskMutation.mutate({ id: recurDeleteState.taskId, scope }), 170);
          }
        }}
      />

      {/* Drop action menu */}
      <DropActionMenu
        position={dropInfo?.dropPosition ?? null}
        isMultiUser={dropInfo ? ((allVisibleTasks.find((t) => t.id === dropInfo.taskId)?.users?.length ?? 0) > 1) : false}
        canMove={(() => {
          const src = dropInfo ? allVisibleTasks.find(t => t.id === dropInfo.taskId) : null;
          if (!src || !canMoveTask(src)) return false;
          if (!dropInfo?.targetRowId) return true;
          const destRow = sortedRows.find(r => r.id === dropInfo.targetRowId);
          if (!destRow || destRow.type !== "row") return true;
          return canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null });
        })()}
        canCopy={(() => {
          if (!canCreateAnyTask) return false;
          if (!dropInfo?.targetRowId) return true;
          const destRow = sortedRows.find(r => r.id === dropInfo.targetRowId);
          if (!destRow || destRow.type !== "row") return true;
          return canCreateOnPlanningRow("users", destRow as { id: string; teamId?: string | null; ownerId?: string | null });
        })()}
        onClose={clearDrop}
        onMove={handleDropMove}
        onMoveUser={handleDropMoveUser}
        onCopy={handleDropCopy}
      />

      {/* Keyboard shortcut toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
