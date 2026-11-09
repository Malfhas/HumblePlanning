"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { format, getISOWeek, isToday as isTodayFn, isWeekend } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { Loader2 } from "lucide-react";

import { usePlanningStore } from "@/stores/planning-store";
import { usePlanningData } from "@/hooks/use-planning-data";
import { dateSettingsFromConfig, formatHourLabel } from "@/lib/utils/dates";
import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { parseDailyTaskLimit, wouldExceedDailyLimit } from "@/lib/utils/daily-task-limit";
import {
  busyPeopleOn, CALENDAR_EVERYONE, calendarPersonRow, calendarTasks, calendarWindow, eachDay, hiddenBarsPerDay,
  layoutBars, parseDailyHours, plannedHoursOn,
} from "@/lib/utils/calendar-view";
import { useMoveTask, useCopyTask, useDeleteTask, useRemoveUserFromTask, useResizeTask, useUpdateTask } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";
import { CalendarColumn } from "./calendar-column";
import { CalendarBar } from "./calendar-items";
import { CalendarDayHeader } from "./calendar-day-header";
import { CalendarDayTaskBlock } from "./calendar-day-task-block";
import { CalendarMonth } from "./calendar-month";
import { useCalendarPeople } from "./calendar-person-select";
import { GridToolbar } from "./grid-toolbar";
import { GridDndContext, type DragCompleteInfo } from "./grid-dnd-context";
import { PlanningContextMenu, DropActionMenu, type ContextMenuState } from "./context-menu";
import { TaskFormDialog } from "./task-form-dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { RecurringDeleteDialog } from "./recurring-delete-dialog";
import type { TaskWithUsers } from "@/types";
import { useDeleteShortcut } from "@/hooks/use-delete-shortcut";
import { deleteOpensDialog, isRecurringTask, isSharedTask } from "@/lib/utils/delete-shortcut";
import { DeleteShortcutHint } from "./delete-shortcut-hint";

/** Minimum height of one hour, driven by the column width slider. The grid
 *  grows beyond it to fill the screen height. */
const SLOT_HEIGHTS: Record<string, number> = {
  compact: 48,
  normal: 60,
  large: 80,
  xlarge: 100,
  xxlarge: 124,
};

const HOUR_COLUMN = 56;
const DAY_HEADER_HEIGHT = 52;
/** One line of the "all day" band: bar (22) + gap. */
const ALL_DAY_LINE = 26;
/** Calendar of everyone: lines of the "all day" band before "+N". */
const EVERYONE_ALL_DAY_LANES = 3;

function parseHourFromTime(timeStr: string): number {
  return parseInt(timeStr.split(":")[0], 10) || 0;
}

type CreatableRow = { id: string; teamId?: string | null; ownerId?: string | null };

/**
 * Calendar view of `/planning`: the tasks of one person, or of everyone the
 * signed-in user may see, over 1, 3, 5 or 7 days (hours or day cards) or over
 * a month. Same actions and permissions as the planning: create, open, move /
 * copy by drag and drop, resize, context menu, clipboard shortcuts. Showing
 * everyone, a task shared by several people comes once with their avatars, and
 * nothing assigns it to a row: the task keeps its people.
 */
export function CalendarGrid() {
  const t = useTranslations("planning");
  const { locale, format: formatDay } = useDateFormat();
  const isMobile = useIsMobile();
  const {
    calendarDays, calendarUserId, startDate, endDate, zoomLevel,
    clipboardTask, setClipboard, clearClipboard, setPendingDrop,
    calendarShow24h, calendarPersonalView, dragOverCellId, markTaskDeleting, showCalendarPeriod,
    setCalendarPersonalView,
  } = usePlanningStore();
  const { data: config, isLoading: configLoading } = useConfig();
  const { userId: currentUserId, can, canCreateAnyTask, canCreateOnPlanningRow, canLockTask, canModifyTask, canDeleteTask, canMoveTask, modifyScope } = usePermissions();
  const dailyLimit = parseDailyTaskLimit(config?.PLANNING_MAX_TASKS_PER_DAY);
  const dailyHours = parseDailyHours(config?.DURATION_DAY);

  // Visible days. The tasks of the planning period are reused when they cover
  // them; otherwise (month grid, period shorter than the days shown) these days are loaded.
  const span = calendarDays;
  const isMonth = span === "month";
  const { start: windowStart, end: windowEnd } = useMemo(() => calendarWindow(startDate, span), [startDate, span]);
  const coveredByPeriod = windowStart >= startDate && windowEnd <= endDate;
  const range = useMemo(
    () => (coveredByPeriod ? undefined : { start: windowStart, end: windowEnd }),
    [coveredByPeriod, windowStart, windowEnd],
  );
  const { tasks, sortedRows, holidays, isLoading, isFetching, error } = usePlanningData({ range });

  // Mutations
  const moveTask = useMoveTask();
  const copyTask = useCopyTask();
  const deleteTaskMutation = useDeleteTask();
  const removeUserMutation = useRemoveUserFromTask();
  const resizeTask = useResizeTask();
  const updateTaskMutation = useUpdateTask();

  const minSlotHeight = SLOT_HEIGHTS[zoomLevel] ?? 60;

  // Default time config
  const defaultStartTime = config?.AM_START || "08:00";
  const defaultEndTime = config?.PM_END || "17:00";

  // Work period hours for highlighting (lunch break shaded too)
  const workStartHour = parseHourFromTime(defaultStartTime);
  const workEndHour = parseHourFromTime(defaultEndTime);
  const breakStartHour = config?.AM_END ? parseHourFromTime(config.AM_END) : undefined;
  const breakEndHour = config?.PM_START ? parseHourFromTime(config.PM_START) : undefined;

  // Generate slots: all 24h or continuous work range based on toggle
  const timeFormat = dateSettingsFromConfig(config ?? {}).timeFormat;
  const all24Slots = useMemo(
    () => Array.from({ length: 24 }, (_, i) => ({ hour: i, label: formatHourLabel(i, locale, timeFormat), index: i })),
    [locale, timeFormat]
  );
  // Continuous range from first work hour to last work hour (no gaps)
  const workRangeSlots = useMemo(
    () => Array.from({ length: Math.max(workEndHour - workStartHour, 1) }, (_, i) => ({
      hour: workStartHour + i,
      label: formatHourLabel(workStartHour + i, locale, timeFormat),
      index: i,
    })),
    [workStartHour, workEndHour, locale, timeFormat]
  );
  const activeSlots = calendarShow24h ? all24Slots : workRangeSlots;

  // Calendar person (signed-in user by default), or everyone the user may see
  // (the people of the person picker: no one beyond them)
  const people = useCalendarPeople();
  const isEveryone = calendarUserId === CALENDAR_EVERYONE;
  const effectiveUserId = isEveryone ? null : calendarUserId || currentUserId;
  const columnId = isEveryone ? CALENDAR_EVERYONE : effectiveUserId ?? "";

  const days = useMemo(() => eachDay(windowStart, windowEnd), [windowStart, windowEnd]);
  const dayStrs = useMemo(() => days.map((d) => format(d, "yyyy-MM-dd")), [days]);

  // Tasks of the calendar person (or of everyone, each task once) over the visible days
  const shownPeople = useMemo(
    () => new Set(isEveryone ? (people ?? []).map((p) => p.id) : effectiveUserId ? [effectiveUserId] : []),
    [isEveryone, people, effectiveUserId],
  );
  const windowTasks = useMemo(() => {
    if (dayStrs.length === 0) return [];
    return calendarTasks(tasks, shownPeople, dayStrs[0], dayStrs[dayStrs.length - 1]);
  }, [tasks, shownPeople, dayStrs]);

  // Group tasks by day
  const tasksByDay = useMemo(() => {
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
    for (const dayStr of dayStrs) {
      const filtered = windowTasks.filter((t) => dayStr >= t.startDate && dayStr <= (t.endDate || t.startDate));
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
  }, [dayStrs, windowTasks]);

  // Hours planned per day (header load badges): one person's, none for everyone
  const hoursByDay = useMemo(() => {
    const map = new Map<string, number>();
    if (isEveryone) return map;
    for (const dayStr of dayStrs) map.set(dayStr, plannedHoursOn(tasksByDay.get(dayStr) ?? [], dayStr, dailyHours));
    return map;
  }, [dayStrs, tasksByDay, dailyHours, isEveryone]);

  // Everyone: people busy per day, out of the people shown (header badges)
  const busyByDay = useMemo(() => {
    const map = new Map<string, number>();
    if (!isEveryone) return map;
    for (const dayStr of dayStrs) map.set(dayStr, busyPeopleOn(tasksByDay.get(dayStr) ?? [], dayStr, shownPeople));
    return map;
  }, [dayStrs, tasksByDay, isEveryone, shownPeople]);

  // All visible tasks (for delete / clipboard lookups)
  const allVisibleTasks = windowTasks;

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

  // Creation in the calendar person's row: same checks for every cell
  // (permission, row scope, daily task limit).
  const canCreateHere = useMemo(() => {
    if (!canCreateAnyTask) return false;
    const row = effectiveUserId ? sortedRows.find((r) => r.id === effectiveUserId) : null;
    return !(row && row.type === "row" && !canCreateOnPlanningRow("users", row as CreatableRow));
  }, [canCreateAnyTask, canCreateOnPlanningRow, effectiveUserId, sortedRows]);

  const canCreateOn = useCallback(
    (dateStr: string) =>
      canCreateHere
      && !(effectiveUserId && wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [effectiveUserId], startDate: dateStr })),
    [canCreateHere, effectiveUserId, tasks, dailyLimit],
  );

  const handleCellClickPersonal = useCallback(
    (dateStr: string, hour: number) => {
      if (!canCreateOn(dateStr)) return;
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
    [effectiveUserId, canCreateOn]
  );

  /** New task on a day, without times ("all day" band, "+" of the month). */
  const handleDayCreate = useCallback(
    (dateStr: string) => {
      if (!canCreateOn(dateStr)) return;
      setEditingTaskId(null);
      setPrefillData({ rowId: effectiveUserId ?? undefined, date: dateStr });
      setDialogOpen(true);
    },
    [effectiveUserId, canCreateOn],
  );

  const openDay = useCallback((day: Date) => showCalendarPeriod(day, 1), [showCalendarPeriod]);
  /** "+N" of the hours view (everyone): the day as cards, where every task has room. */
  const openDayCards = useCallback((day: Date) => {
    setCalendarPersonalView("days");
    showCalendarPeriod(day, 1);
  }, [setCalendarPersonalView, showCalendarPeriod]);
  const openWeek = useCallback((monday: Date) => showCalendarPeriod(monday, 7), [showCalendarPeriod]);

  // --- Context menu handlers ---

  const handleTaskContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId, rowId: effectiveUserId ?? undefined });
  }, [effectiveUserId]);

  const handleCellContextMenuPersonal = useCallback((e: React.MouseEvent, dateStr: string, hour?: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, rowId: effectiveUserId ?? undefined, dateStr, hour });
  }, [effectiveUserId]);

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
    } else if (task && task.users?.length > 1) {
      // Showing everyone, no row: the dialog only offers to delete the task
      setMultiDeleteState({ taskId, rowId: calendarPersonRow(rowId) ?? "" });
    } else {
      markTaskDeleting(taskId);
      setTimeout(() => deleteTaskMutation.mutate({ id: taskId }), 170);
    }
  }, [deleteTaskMutation, allVisibleTasks, markTaskDeleting]);

  const handleCreateTask = useCallback((rowId: string, cellDateStr: string) => {
    setEditingTaskId(null);
    setPrefillData({ rowId: calendarPersonRow(rowId), date: cellDateStr });
    setDialogOpen(true);
  }, []);

  const handlePaste = useCallback((rowId: string, cellDateStr: string, hour?: number) => {
    if (!clipboardTask) return;

    // Showing everyone, no row: the task keeps its people
    const row = calendarPersonRow(rowId);
    const rowFieldData: Record<string, unknown> = row ? { userIds: [row] } : {};

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
    if (!task) return;
    resizeTask.mutate({
      id: taskId,
      data: {
        endDate: task.endDate ?? task.startDate,
        startTime,
        endTime,
      },
    });
  }, [resizeTask, allVisibleTasks]);

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
        // Destination: always the calendar person ("users" row), checked
        // through canCreateOnPlanningRow.
        const destRow = sortedRows.find((r) => r.id === rowId);
        if (destRow && destRow.type === "row" && !canCreateOnPlanningRow("users", destRow as CreatableRow)) return;
        e.preventDefault();
        handlePaste(rowId, cellDateStr, isNaN(hour as number) ? undefined : hour);
        showToast(clipboardTask.mode === "copy" ? t("grid.clipboard.pastedCopy") : t("grid.clipboard.pastedMove"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clipboardTask, setClipboard, handlePaste, allVisibleTasks, showToast, can, canCreateAnyTask, canMoveTask, canCreateOnPlanningRow, sortedRows, t]);

  // --- Delete key on the task under the cursor: same rules and action as the « Delete » item of the menu ---
  const deleteHint = useDeleteShortcut({
    enabled: true,
    resolve: (clientX, clientY) => {
      const el = document.elementsFromPoint(clientX, clientY)
        .find((node): node is HTMLElement => node instanceof HTMLElement && !!node.dataset.taskId);
      if (!el) return null;
      const taskId = el.dataset.taskId!;
      const task = allVisibleTasks.find((t) => t.id === taskId);
      const r = el.getBoundingClientRect();
      return {
        key: taskId,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        canDelete: !!task && !task.isLocked && canDeleteTask(task),
        opensDialog: deleteOpensDialog(isSharedTask(task), isRecurringTask(task)),
      };
    },
    onConfirm: (taskId) => handleDeleteTask(taskId, effectiveUserId ?? undefined),
  });

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
    const targetRowId = calendarPersonRow(dropInfo.targetRowId);
    moveTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dropInfo.newStartDate,
        endDate: dropInfo.newEndDate,
        ...(dropInfo.newStartTime ? { startTime: dropInfo.newStartTime } : {}),
        ...(dropInfo.newEndTime ? { endTime: dropInfo.newEndTime } : {}),
        ...(isMultiUser ? {} : (targetRowId ? { userIds: [targetRowId] } : {})),
      },
    });
    clearDrop();
  }, [dropInfo, moveTask, clearDrop, allVisibleTasks]);

  const handleDropCopy = useCallback(() => {
    if (!dropInfo) return;
    const targetRowId = calendarPersonRow(dropInfo.targetRowId);
    copyTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dropInfo.newStartDate,
        ...(dropInfo.newStartTime ? { startTime: dropInfo.newStartTime } : {}),
        ...(dropInfo.newEndTime ? { endTime: dropInfo.newEndTime } : {}),
        ...(targetRowId ? { userIds: [targetRowId] } : {}),
      },
    });
    clearDrop();
  }, [dropInfo, copyTask, clearDrop]);

  const handleDropMoveUser = useCallback(() => {
    const sourceUserId = calendarPersonRow(dropInfo?.sourceRowId);
    if (!dropInfo || !sourceUserId) return;
    removeUserMutation.mutate({ taskId: dropInfo.taskId, userId: sourceUserId });
    copyTask.mutate({
      id: dropInfo.taskId,
      data: { startDate: dropInfo.newStartDate, userIds: [sourceUserId] },
    });
    clearDrop();
  }, [dropInfo, removeUserMutation, copyTask, clearDrop]);

  // --- Layout: the grid fills the available height ---
  // `useState` + ref callback (React 19 StrictMode-safe): the scroll container
  // only exists once the data is loaded.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const [viewportHeight, setViewportHeight] = useState(0);
  useEffect(() => {
    if (!scrollEl) return;
    const update = () => setViewportHeight(scrollEl.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);

  // "All day" band: tasks without times, as bars over their days. Showing
  // everyone, a few lines then "+N" per day (the day as cards shows them all).
  const allDayLayout = useMemo(
    () => layoutBars(dayStrs, windowTasks.filter((task) => !task.startTime)),
    [dayStrs, windowTasks],
  );
  const allDayLanes = isEveryone ? Math.min(allDayLayout.laneCount, EVERYONE_ALL_DAY_LANES) : allDayLayout.laneCount;
  const allDayHidden = useMemo(
    () => hiddenBarsPerDay(allDayLayout.bars, dayStrs.length, allDayLanes),
    [allDayLayout.bars, dayStrs.length, allDayLanes],
  );
  const allDayMoreLine = allDayHidden.some((n) => n > 0) ? 1 : 0;
  const allDayHeight = Math.max((allDayLanes + allDayMoreLine) * ALL_DAY_LINE + 8, 30);
  const fillSlotHeight = viewportHeight > 0
    ? Math.floor((viewportHeight - DAY_HEADER_HEIGHT - allDayHeight - 1) / activeSlots.length)
    : 0;
  const slotHeight = Math.max(minSlotHeight, fillSlotHeight);
  const totalHeight = activeSlots.length * slotHeight;

  const isDaysView = !isMonth && calendarPersonalView === "days";

  // Initial scroll (when the hours do not fit, e.g. 24 h): the current hour
  // when today is shown, otherwise the start of the working day.
  const scrolledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || isMonth || isDaysView || viewportHeight === 0) return;
    const key = `${span}:${calendarShow24h}`;
    if (scrolledKeyRef.current === key) return;
    scrolledKeyRef.current = key;
    const todayShown = days.some((d) => isTodayFn(d));
    const targetHour = todayShown ? new Date().getHours() - 1 : workStartHour;
    const index = activeSlots.findIndex((slot) => slot.hour >= targetHour);
    el.scrollTop = Math.max(index, 0) * slotHeight;
  }, [scrollEl, isMonth, isDaysView, viewportHeight, span, calendarShow24h, days, workStartHour, activeSlots, slotHeight]);

  const handleCreateTaskButton = useCallback(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    setEditingTaskId(null);
    setPrefillData({
      rowId: effectiveUserId ?? undefined,
      date: today,
    });
    setDialogOpen(true);
  }, [effectiveUserId]);

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

  const dayCount = days.length;
  const minColumnWidth = isMobile && dayCount > 1 ? 104 : 72;
  const firstWeek = days.length ? getISOWeek(days[0]) : 0;
  const lastWeek = days.length ? getISOWeek(days[days.length - 1]) : 0;
  const weekLabel = t("calendar.weekShort", { week: firstWeek === lastWeek ? String(firstWeek) : `${firstWeek}–${lastWeek}` });
  const showEmpty = !isFetching && (isEveryone || !!effectiveUserId) && windowTasks.length === 0;
  // Showing everyone, overlapping timed tasks side by side, at most (then "+N")
  const everyoneColumns = isMobile ? 2 : dayCount === 1 ? 6 : dayCount <= 3 ? 4 : 3;
  const openDayFromHeader = dayCount > 1 ? openDay : undefined;

  /** Header cell of a day column (sticky). */
  const dayHeaderCell = (day: Date, dayStr: string) => (
    <div
      key={`head-${dayStr}`}
      className={cn("sticky top-0 z-20 border-b border-r bg-background", isTodayFn(day) && "bg-[color-mix(in_oklch,var(--primary)_4%,var(--background))]")}
      style={{ height: DAY_HEADER_HEIGHT }}
    >
      <CalendarDayHeader
        day={day}
        holiday={holidays.get(dayStr) ?? null}
        hours={hoursByDay.get(dayStr) ?? 0}
        dailyHours={dailyHours}
        people={isEveryone ? { busy: busyByDay.get(dayStr) ?? 0, total: shownPeople.size } : undefined}
        onOpen={openDayFromHeader}
      />
    </div>
  );

  // ===== DAYS VIEW (no hours, day cards) =====
  const daysView = (
    <div
      className="grid min-w-full"
      style={{
        gridTemplateColumns: `repeat(${dayCount}, minmax(${isMobile && dayCount > 1 ? 150 : 140}px, 1fr))`,
        gridTemplateRows: `${DAY_HEADER_HEIGHT}px 1fr`,
        minHeight: viewportHeight || undefined,
      }}
    >
      {days.map((day, i) => dayHeaderCell(day, dayStrs[i]))}
      {days.map((day, i) => {
        const dayStr = dayStrs[i];
        const today = isTodayFn(day);
        const holiday = holidays.get(dayStr) ?? null;
        const dayTasks = tasksByDay.get(dayStr) ?? [];
        const cellId = `${columnId}:${dayStr}`;
        const isDragOver = dragOverCellId === cellId;
        return (
          <div
            key={dayStr}
            data-cell-id={cellId}
            className={cn(
              "space-y-1 border-r p-1.5 transition-colors duration-100",
              isDragOver ? "!bg-primary/10 ring-2 ring-inset ring-primary/40" : today ? "bg-primary/5" : isWeekend(day) ? "bg-muted/30" : "",
            )}
            style={holiday && !isDragOver ? { backgroundColor: `color-mix(in srgb, ${holiday.color} 8%, transparent)` } : undefined}
            onContextMenu={(e) => handleCellContextMenuPersonal(e, dayStr)}
          >
            {dayTasks.map((task) => (
              <CalendarDayTaskBlock
                key={task.id}
                task={task}
                columnId={columnId}
                draggableKey={dayStr}
                onClick={handleTaskClick}
                onContextMenu={handleTaskContextMenu}
                showPeople={isEveryone}
              />
            ))}
            {dayTasks.length === 0 && canCreateOn(dayStr) && (
              <button
                type="button"
                className="flex h-16 w-full items-center justify-center rounded border border-dashed border-border/60 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/30"
                aria-label={t("calendar.newTaskOn", { date: formatDay(day, "EEEE d MMMM") })}
                onClick={() => handleCellClickPersonal(dayStr, workStartHour)}
              >
                +
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  // ===== HOURS VIEW =====
  const hoursView = (
    <div
      className="grid min-w-full"
      style={{ gridTemplateColumns: `${HOUR_COLUMN}px repeat(${dayCount}, minmax(${minColumnWidth}px, 1fr))` }}
    >
      {/* ---- Header row (sticky): week number + days ---- */}
      <div
        className="sticky left-0 top-0 z-30 flex items-end justify-center border-b border-r bg-background pb-2 text-[10px] font-medium text-muted-foreground"
        style={{ height: DAY_HEADER_HEIGHT }}
        title={t("calendar.weekTitle", { week: firstWeek === lastWeek ? String(firstWeek) : `${firstWeek}–${lastWeek}` })}
      >
        {weekLabel}
      </div>
      {days.map((day, i) => dayHeaderCell(day, dayStrs[i]))}

      {/* ---- All-day band (sticky under the header): bars over their days ---- */}
      <div
        className="sticky left-0 z-30 flex items-center justify-end border-b border-r bg-muted/60 pr-2 text-[10px] text-muted-foreground backdrop-blur"
        style={{ top: DAY_HEADER_HEIGHT, height: allDayHeight }}
      >
        {t("grid.allDay")}
      </div>
      <div
        className="sticky z-20 border-b bg-background"
        style={{ top: DAY_HEADER_HEIGHT, height: allDayHeight, gridColumn: `2 / span ${dayCount}` }}
      >
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>
          {days.map((day, i) => {
            const dayStr = dayStrs[i];
            const cellId = `${columnId}:${dayStr}:allday`;
            const isDragOver = dragOverCellId === cellId;
            return (
              <div
                key={`allday-${dayStr}`}
                data-cell-id={cellId}
                className={cn(
                  "border-r transition-colors duration-100",
                  canCreateHere && "cursor-pointer hover:bg-primary/5",
                  isDragOver ? "!bg-primary/10 ring-2 ring-inset ring-primary/40" : isTodayFn(day) ? "bg-primary/[0.04]" : isWeekend(day) ? "bg-muted/30" : "",
                )}
                onContextMenu={(e) => handleCellContextMenuPersonal(e, dayStr)}
                onClick={() => handleDayCreate(dayStr)}
              />
            );
          })}
        </div>
        {allDayLayout.bars.filter((bar) => bar.lane < allDayLanes).map((bar) => (
          <CalendarBar
            key={`allday-${bar.task.id}`}
            task={bar.task}
            draggableId={`cal-allday:${bar.task.id}:${columnId}`}
            columnId={columnId}
            clippedStart={bar.clippedStart}
            clippedEnd={bar.clippedEnd}
            onClick={handleTaskClick}
            onContextMenu={handleTaskContextMenu}
            showPeople={isEveryone}
            style={{
              position: "absolute",
              top: 4 + bar.lane * ALL_DAY_LINE,
              left: `calc(${bar.start} * 100% / ${dayCount} + ${bar.clippedStart ? 0 : 3}px)`,
              width: `calc(${bar.length} * 100% / ${dayCount} - ${(bar.clippedStart ? 0 : 3) + (bar.clippedEnd ? 0 : 3)}px)`,
              zIndex: 2,
            }}
          />
        ))}
        {allDayHidden.map((count, i) => count > 0 && (
          <button
            key={`allday-more-${dayStrs[i]}`}
            type="button"
            className="absolute h-[22px] rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              top: 4 + allDayLanes * ALL_DAY_LINE,
              left: `calc(${i} * 100% / ${dayCount} + 3px)`,
              width: `calc(100% / ${dayCount} - 6px)`,
              zIndex: 2,
            }}
            title={t("calendar.showMore", { count })}
            onClick={() => openDayCards(days[i])}
          >
            {t("calendar.more", { count })}
          </button>
        ))}
      </div>

      {/* ---- Body: hour labels (sticky left) + day columns ---- */}
      <div className="sticky left-0 z-10 border-r bg-background" style={{ height: totalHeight }}>
        {activeSlots.map((slot, i) => (
          <div
            key={slot.hour}
            className="absolute inset-x-0 border-b border-border/50"
            style={{ top: i * slotHeight, height: slotHeight }}
          >
            <span className="absolute right-2 top-1 text-[11px] tabular-nums text-muted-foreground">{slot.label}</span>
          </div>
        ))}
      </div>
      {days.map((day, i) => {
        const dayStr = dayStrs[i];
        return (
          <CalendarColumn
            key={dayStr}
            tasks={(tasksByDay.get(dayStr) ?? []).filter((task) => !!task.startTime)}
            slots={activeSlots}
            slotHeight={slotHeight}
            dateStr={dayStr}
            isToday={isTodayFn(day)}
            isWeekendDay={isWeekend(day)}
            isHoliday={holidays.get(dayStr) ?? null}
            onTaskClick={handleTaskClick}
            onCellClick={handleCellClickPersonal}
            onTaskContextMenu={handleTaskContextMenu}
            onCellContextMenu={handleCellContextMenuPersonal}
            defaultStartTime={defaultStartTime}
            defaultEndTime={defaultEndTime}
            workStartHour={workStartHour}
            workEndHour={workEndHour}
            breakStartHour={breakStartHour}
            breakEndHour={breakEndHour}
            columnId={columnId || dayStr}
            onResize={handleCalendarResize}
            showPeople={isEveryone}
            maxColumns={isEveryone ? everyoneColumns : undefined}
            onShowMore={() => openDayCards(day)}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <GridToolbar onCreateTask={handleCreateTaskButton} />

      <GridDndContext tasks={allVisibleTasks} onDragComplete={handleDragComplete}>
        <div className="relative min-h-0 flex-1" data-calendar-view={isMonth ? "month" : isDaysView ? "days" : "hours"}>
          {/* Loading another period (previous data stays visible meanwhile) */}
          {isFetching && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 animate-pulse bg-primary/60" />
          )}

          {isMonth ? (
            <CalendarMonth
              anchor={startDate}
              days={days}
              tasks={windowTasks}
              tasksByDay={tasksByDay}
              holidays={holidays}
              columnId={columnId}
              dailyHours={dailyHours}
              canCreate={canCreateHere}
              dragOverCellId={dragOverCellId}
              onOpenDay={openDay}
              onOpenWeek={openWeek}
              onCreate={handleDayCreate}
              onTaskClick={handleTaskClick}
              onTaskContextMenu={handleTaskContextMenu}
              onDayContextMenu={handleCellContextMenuPersonal}
              everyone={isEveryone}
              shownPeople={shownPeople}
            />
          ) : (
            <div ref={attachScroll} className="h-full overflow-auto">
              {isDaysView ? daysView : hoursView}
            </div>
          )}

          {/* Empty period: explicit message, the grid stays usable */}
          {showEmpty && (
            <div className="pointer-events-none absolute inset-x-0 top-1/3 z-30 flex justify-center px-4">
              <div className="rounded-lg border bg-background/95 px-4 py-3 text-center shadow-sm backdrop-blur">
                <p className="text-sm font-medium">{t("calendar.empty")}</p>
                {canCreateHere && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isMonth ? t("calendar.emptyHintMonth") : t("calendar.emptyHint")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </GridDndContext>

      {/* Context menu */}
      <DeleteShortcutHint hint={deleteHint} />

      <PlanningContextMenu
        state={contextMenu}
        onClose={handleCloseContextMenu}
        hasClipboard={!!clipboardTask}
        isMultiUser={contextMenu?.taskId ? isSharedTask(allVisibleTasks.find((t) => t.id === contextMenu.taskId)) : false}
        isRecurring={contextMenu?.taskId ? isRecurringTask(allVisibleTasks.find((t) => t.id === contextMenu.taskId)) : false}
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
          // The destination is always the calendar person, so check the
          // selected row if it is known.
          if (!contextMenu?.rowId) return true;
          const destRow = sortedRows.find(r => r.id === contextMenu.rowId);
          if (!destRow || destRow.type !== "row") return true;
          return canCreateOnPlanningRow("users", destRow as CreatableRow);
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
        onArchive={multiDeleteState?.rowId ? () => {
          if (multiDeleteState) {
            removeUserMutation.mutate({
              taskId: multiDeleteState.taskId,
              userId: multiDeleteState.rowId,
              scope: pendingRecurScope?.scope,
            });
            setMultiDeleteState(null);
            setPendingRecurScope(null);
          }
        } : undefined}
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
          const rowId = calendarPersonRow(recurDeleteState.rowId);
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
          return canCreateOnPlanningRow("users", destRow as CreatableRow);
        })()}
        canCopy={(() => {
          if (!canCreateAnyTask) return false;
          if (!dropInfo?.targetRowId) return true;
          const destRow = sortedRows.find(r => r.id === dropInfo.targetRowId);
          if (!destRow || destRow.type !== "row") return true;
          return canCreateOnPlanningRow("users", destRow as CreatableRow);
        })()}
        onClose={clearDrop}
        onMove={handleDropMove}
        onMoveUser={isEveryone ? undefined : handleDropMoveUser}
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
