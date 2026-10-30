"use client";

/**
 * PlanningCanvasHours — Hours view of the schedule rendered with Canvas 2D.
 *
 * Architecture similar to `<PlanningCanvas>` but with:
 *   - 1 visible day (selectedDay) instead of a multi-day window
 *   - Columns = hours (HOURS_DISPLAYED or 24h)
 *   - Per-minute slot allocator (allocateTimeSlots)
 *   - 2-line header (date + hours)
 *   - No va:/ra: pseudo-tasks (hours view users/projects only)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import {
  ClipboardCopy,
  ClipboardPaste,
  Scissors,
} from "lucide-react";
import { format, getISOWeek, isToday, isWeekend } from "date-fns";
import { gridScrollBounds, SCROLLBAR_SIZE, scrollThumbLength } from "@/lib/canvas/scroll-bounds";
import type { Locale as DateFnsLocale } from "date-fns";
import { localizeDatePattern } from "@/i18n/date-locale";
import { useDateFormat } from "@/hooks/use-date-format";
import { dateSettingsFromConfig, formatHourLabel, type TimeFormat } from "@/lib/utils/dates";
import type { AppLocale } from "@/i18n/config";

import { TooltipProvider } from "@/components/ui/tooltip";
import { usePlanningStore } from "@/stores/planning-store";
import { usePlanningData } from "@/hooks/use-planning-data";
import { usePlanningConfig } from "@/hooks/use-planning-config";
import { usePermissions } from "@/hooks/use-permissions";
import { useConfig } from "@/hooks/use-config";
import {
  useMoveTask,
  useCopyTask,
  useResizeTask,
  useDeleteTask,
  useUpdateTask,
  useRemoveUserFromTask,
} from "@/hooks/use-tasks";
import { parseDailyTaskLimit, wouldExceedDailyLimit } from "@/lib/utils/daily-task-limit";
import {
  parseHoursConfig,
  buildTimeSlots,
  type TimeSlot,
} from "@/lib/utils/time-slots";
import { allocateTimeSlots } from "@/lib/utils/slot-allocator-time";
import { setupHiDPI, observeResize } from "@/lib/canvas/dpr";
import { vibrantizeColor } from "@/lib/canvas/theme";
import { getTaskLabel } from "@/lib/utils/task-label";
import type { ViewMode } from "@/stores/planning-store";
import { CANVAS_ICONS, drawCanvasIcon, ICON_SIZE_DEFAULT, ICON_SIZE_MEDIUM, getIconLayoutWidth } from "@/lib/canvas/icons";
import { headerIconFor } from "@/lib/canvas/renderer";
import { drawSkeletonCell } from "@/lib/canvas/skeleton";
import { CONTRACT_TYPES, getContractSuffix, type ContractTypeKey } from "@/lib/constants/contract-types";
import { tDyn } from "@/i18n/dynamic";
// i18n-dynamic: users.contractTypes.*
import {
  ANIM_DURATIONS,
  computeAnimEffect,
  easeOutExpo,
  easeOutQuart,
  easeOutBack,
  easeInQuad,
  isAnimDone,
  NEUTRAL_EFFECT,
  type TaskAnim,
} from "@/lib/canvas/animations";
import { GridToolbar } from "./grid-toolbar";
import { TaskFormDialog } from "./task-form-dialog";
import { TaskTooltip } from "./task-tooltip";
import { UserTooltip } from "./user-tooltip";
import { ProjectTooltip } from "./project-tooltip";
import { CanvasTooltipAnchor } from "./canvas-tooltip-anchor";
import {
  DropActionMenu,
  PlanningContextMenu,
  type ContextMenuState,
} from "./context-menu";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { RecurringDeleteDialog } from "./recurring-delete-dialog";
import type { GridRow } from "@/lib/utils/sort-rows";
import type { TaskWithUsers } from "@/types";

// ──────────────────────────────────────────────────────────────────
// Geometry constants
// ──────────────────────────────────────────────────────────────────

/** True if the ID is an optimistic placeholder awaiting the server response:
 *  `__optimistic_xxx` (tasks via use-tasks.ts) or `va:__optimistic_va_xxx` /
 *  `ra:__optimistic_ra_xxx` (assignment pseudo-tasks, `va:`/`ra:` prefix
 *  added by use-planning-data). Used to skip the "appear" anim on the
 *  optimistic AND on its server replacement. */
function isOptimisticId(id: string): boolean {
  return (
    id.startsWith("__optimistic_") ||
    id.startsWith("va:__optimistic_") ||
    id.startsWith("ra:__optimistic_")
  );
}

const HEADER_DAY_HEIGHT = 32;
const HEADER_HOUR_HEIGHT = 28;
const HEADER_TOTAL_HEIGHT = HEADER_DAY_HEIGHT + HEADER_HOUR_HEIGHT;
const TASK_BAR_GAP = 4;
const ROW_PADDING = 4;
const MIN_ROW_HEIGHT = 36;
const SIDEBAR_WIDTH_DEFAULT = 200;
const RESIZE_HANDLE_WIDTH = 6;
const DRAG_ACTIVATION_DISTANCE = 8;

interface AllocatedTaskInRow {
  id: string;
  task: TaskWithUsers;
  slot: number;
  startMin: number;
  endMin: number;
}

interface AllocatedRow {
  row: GridRow;
  y: number;
  height: number;
  tasks: AllocatedTaskInRow[];
}

type DragMode = "move" | "resize-left" | "resize-right";

interface DragState {
  active: boolean;
  taskId: string | null;
  mode: DragMode | null;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  /** Offset in hours from the origin (snapped per hour). */
  deltaHours: number;
  /** Current target row (may differ from the source during a move). */
  targetRowId: string | null;
  sourceRowId: string;
  /** Snapshot of the source coords FROZEN at pointerdown.
   *  Keeps the drag preview from being skewed by the optimistic cache
   *  update (mutate.onMutate fires before the end of the 150 ms post-release hold). */
  originStartMin: number;
  originEndMin: number;
  originSlot: number;
}

const INITIAL_DRAG: DragState = {
  active: false,
  taskId: null,
  mode: null,
  startX: 0,
  startY: 0,
  pointerX: 0,
  pointerY: 0,
  deltaHours: 0,
  targetRowId: null,
  sourceRowId: "",
  originStartMin: 0,
  originEndMin: 0,
  originSlot: 0,
};

export function PlanningCanvasHours() {
  // ───── Language (precomputed labels: no t() in the render loop) ─────
  const t = useTranslations("planning");
  const tUsers = useTranslations("users");
  const { dateLocale, locale } = useDateFormat();
  const { data: appConfig } = useConfig();
  const timeFormat = dateSettingsFromConfig(appConfig ?? {}).timeFormat;
  const hoursI18n = useMemo<HoursCanvasI18n>(
    () => ({
      dateLocale,
      locale,
      timeFormat,
      weekPrefix: t("canvas.weekPrefix"),
      contractLabels: Object.fromEntries(
        CONTRACT_TYPES.map((c) => [c.key, tDyn(tUsers, `contractTypes.${c.key}`)]),
      ) as Record<ContractTypeKey, string>,
    }),
    [dateLocale, locale, timeFormat, t, tUsers],
  );
  const untitledLabel = t("canvas.untitled");

  // ───── Store ─────
  const { viewMode, selectedDay, slotWidth, showRowAvatar, showSummary, clipboardTask, setClipboard, clearClipboard } = usePlanningStore(
    useShallow((s) => ({
      viewMode: s.viewMode,
      selectedDay: s.selectedDay,
      slotWidth: s.slotWidth,
      showRowAvatar: s.showRowAvatar,
      showSummary: s.showSummary,
      clipboardTask: s.clipboardTask,
      setClipboard: s.setClipboard,
      clearClipboard: s.clearClipboard,
    }))
  );
  const calendarShow24h = usePlanningStore((s) => s.calendarShow24h);

  // ───── Data ─────
  const { tasks, sortedRows, statusMap, isLoading, isLoadingRows, isLoadingTasks, isFetching, error } = usePlanningData();
  const { taskBarHeight: barH, fontFamily, cellFontSize, fontBold, sidebarWidth: configSidebarWidth, sidebarWidthMobileMax } = usePlanningConfig();

  // Effective sidebar width: fixed config or auto (measures the
  // longest label, capped by the mobile max on small screens).
  // Parity with the days canvas `planning-canvas.tsx:162`.
  const computedSidebarWidth = useMemo(() => {
    if (configSidebarWidth !== "auto") return configSidebarWidth;
    if (typeof document === "undefined") return SIDEBAR_WIDTH_DEFAULT;
    const measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) return SIDEBAR_WIDTH_DEFAULT;
    ctx.font = "500 14px ui-sans-serif, system-ui, sans-serif";
    let maxLabelW = 0;
    for (const row of sortedRows) {
      if (row.type === "header") continue;
      // Users view: the "[Temporary worker]" suffix is part of the displayed name.
      const suffix = viewMode === "users"
        ? getContractSuffix((row as { contractType?: string | null }).contractType, (key) => hoursI18n.contractLabels[key])
        : null;
      const wMeasure = ctx.measureText(suffix ? `${row.name ?? ""} [${suffix}]` : row.name ?? "").width;
      if (wMeasure > maxLabelW) maxLabelW = wMeasure;
    }
    const autoWidth = Math.max(160, Math.ceil(maxLabelW + 48));
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    return isMobile ? Math.min(autoWidth, sidebarWidthMobileMax) : autoWidth;
  }, [configSidebarWidth, sortedRows, sidebarWidthMobileMax, viewMode, hoursI18n]);

  // ───── Permissions ─────
  const {
    can,
    canCreateAnyTask,
    canCreateOnPlanningRow,
    canModifyTask,
    canDeleteTask,
    canMoveTask,
    canResizeTask,
    canLockTask,
    modifyScope,
  } = usePermissions();
  // Unified task / vehicleAssignment / resourceAssignment permission
  // for resizing (handles + ew-resize cursor). Used by the renderer
  // and the hit-test. For real tasks we delegate to the hook's
  // `canResizeTask` (which combines edit scope + the `tasks:resize`
  // permission). For va/ra pseudo-tasks we fall back on the module's
  // "edit" permission — no independent resize toggle.
  const canResizeTaskFn = useCallback(
    (task: TaskWithUsers): boolean => {
      if (task.id.startsWith("va:")) return can("vehicles:edit");
      if (task.id.startsWith("ra:")) return can("resources:edit");
      return canResizeTask(task);
    },
    [can, canResizeTask],
  );
  const dailyLimit = useMemo(
    () => parseDailyTaskLimit(appConfig?.PLANNING_MAX_TASKS_PER_DAY),
    [appConfig?.PLANNING_MAX_TASKS_PER_DAY]
  );

  // Touch detection (parity with the days canvas): on mobile, disable
  // drag/resize/tooltips. The user only has click to create/open, a
  // finger swipe scrolls the grid via touch panning.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouchDevice(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ───── Mutations ─────
  const moveTask = useMoveTask();
  const copyTask = useCopyTask();
  const resizeTask = useResizeTask();
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const removeUserMutation = useRemoveUserFromTask();

  // ───── Hour slots ─────
  const slots = useMemo<TimeSlot[]>(() => {
    if (calendarShow24h) {
      return buildTimeSlots(Array.from({ length: 24 }, (_, i) => i));
    }
    const raw = appConfig?.HOURS_DISPLAYED ?? null;
    return buildTimeSlots(parseHoursConfig(raw));
  }, [calendarShow24h, appConfig?.HOURS_DISPLAYED]);

  const dateStr = useMemo(() => format(selectedDay, "yyyy-MM-dd"), [selectedDay]);

  // ───── Filtering of the selected day's tasks ─────
  const dayTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.startDate ?? "") <= dateStr &&
          ((t.endDate ?? t.startDate) ?? "") >= dateStr
      ),
    [tasks, dateStr]
  );

  const taskIndex = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // ───── Helpers hour → pixel & inverse ─────
  const firstHour = slots[0]?.hour ?? 8;
  const lastHour = (slots[slots.length - 1]?.hour ?? 17) + 1;
  /** Finds the slot index for a given hour (or -1 if out of range). */
  const findSlotIdx = useCallback(
    (hour: number): number => {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].hour === hour) return i;
      }
      // Fallback: take the closest slot below
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i].hour <= hour) return i;
      }
      return -1;
    },
    [slots]
  );
  /** Pixel x → closest whole hour (snap). */
  const pixelToHour = useCallback(
    (xRel: number): number => {
      const idx = Math.max(0, Math.min(slots.length - 1, Math.floor(xRel / slotWidth)));
      return slots[idx]?.hour ?? firstHour;
    },
    [slots, slotWidth, firstHour]
  );

  // ───── Vertical slot allocation per row ─────
  const allocatedRows = useMemo<AllocatedRow[]>(() => {
    const result: AllocatedRow[] = [];
    let y = 0;
    for (const row of sortedRows) {
      if (row.type === "header") {
        result.push({ row, y, height: 28, tasks: [] });
        y += 28;
        continue;
      }
      const rowTasks: TaskWithUsers[] = [];
      for (const t of dayTasks) {
        if (viewMode === "users") {
          if (t.users?.some((u) => u.id === row.id)) rowTasks.push(t);
        } else {
          const k =
            viewMode === "projects" ? "projectId" :
            viewMode === "places" ? "placeId" :
            viewMode === "resources" ? "resourceId" : "vehicleId";
          const key = (t as Record<string, unknown>)[k] as string | undefined;
          if (key === row.id) rowTasks.push(t);
        }
      }
      const timeSlotTasks = rowTasks.map((t) => {
        const isAllDay = !t.startTime;
        const startH = t.startTime ? parseInt(t.startTime.split(":")[0], 10) : firstHour;
        const startMin = t.startTime
          ? startH * 60 + parseInt(t.startTime.split(":")[1] || "0", 10)
          : firstHour * 60;
        const endH = t.endTime ? parseInt(t.endTime.split(":")[0], 10) : lastHour;
        const endMinRaw = t.endTime
          ? endH * 60 + parseInt(t.endTime.split(":")[1] || "0", 10)
          : lastHour * 60;
        const endMin = Math.max(endMinRaw, startMin + 30);
        return {
          id: t.id,
          startMinutes: startMin,
          endMinutes: endMin,
          isAllDay,
          createdAt: String(t.createdAt ?? ""),
        };
      });
      const { allocated, maxSlot } = allocateTimeSlots(timeSlotTasks);
      const height = Math.max(MIN_ROW_HEIGHT, (maxSlot + 1) * (barH + TASK_BAR_GAP) + 8);
      const m = new Map(rowTasks.map((t) => [t.id, t]));
      const allocatedTasks = allocated.map((a) => ({
        id: a.id,
        task: m.get(a.id)!,
        slot: a.slot,
        startMin: a.startMinutes,
        endMin: a.endMinutes,
      }));
      result.push({ row, y, height, tasks: allocatedTasks });
      y += height;
    }
    return result;
  }, [sortedRows, dayTasks, viewMode, firstHour, lastHour]);

  const totalContentHeight = useMemo(
    () => allocatedRows.reduce((s, r) => s + r.height, 0),
    [allocatedRows]
  );
  const totalGridWidth = useMemo(() => slots.length * slotWidth, [slots.length, slotWidth]);

  /** Helpers: rect of a bar. */
  const getBarRect = useCallback(
    (taskAlloc: AllocatedTaskInRow, ar: AllocatedRow, scrollX_: number, scrollY_: number) => {
      const startH = Math.floor(taskAlloc.startMin / 60);
      const endH = Math.ceil(taskAlloc.endMin / 60);
      const startIdx = findSlotIdx(startH);
      const endIdx = findSlotIdx(endH - 1);
      if (startIdx < 0) return null;
      const finalEndIdx = endIdx >= 0 ? endIdx : slots.length - 1;
      const left = computedSidebarWidth + startIdx * slotWidth - scrollX_ + 2;
      const width = Math.max((finalEndIdx - startIdx + 1) * slotWidth - 4, 12);
      const top =
        HEADER_TOTAL_HEIGHT + ar.y - scrollY_ + taskAlloc.slot * (barH + TASK_BAR_GAP) + ROW_PADDING;
      return { x: left, y: top, width, height: barH };
    },
    [findSlotIdx, slots.length, slotWidth, computedSidebarWidth, barH]
  );

  // ───── Refs DOM ─────
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [staticCanvas, setStaticCanvas] = useState<HTMLCanvasElement | null>(null);
  const [interactiveCanvas, setInteractiveCanvas] = useState<HTMLCanvasElement | null>(null);
  const tooltipAnchorRef = useRef<HTMLDivElement>(null);

  // ───── Size + scroll ─────
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  // Custom scrollbars: isScrollbarDragging disables tooltips while
  // dragging the thumb. Declared here because it is needed before the tooltip effect.
  const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);

  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    cleanupResizeRef.current?.();
    cleanupResizeRef.current = null;
    containerRef.current = node;
    setContainerNode(node);
    if (!node) return;
    cleanupResizeRef.current = observeResize(node, (s) => setSize(s));
  }, []);
  useEffect(() => () => cleanupResizeRef.current?.(), []);

  // ───── DPR setup ─────
  useEffect(() => {
    if (!staticCanvas || size.width === 0 || size.height === 0) return;
    setupHiDPI(staticCanvas, size.width, size.height);
    dirtyRef.current = true;
  }, [staticCanvas, size]);
  useEffect(() => {
    if (!interactiveCanvas || size.width === 0 || size.height === 0) return;
    setupHiDPI(interactiveCanvas, size.width, size.height, true);
  }, [interactiveCanvas, size]);

  // ───── Drag state (ref for 60fps) ─────
  const dragStateRef = useRef<DragState>({ ...INITIAL_DRAG });
  const isDragActiveRef = useRef(false);
  const hoveredTaskIdRef = useRef<string | null>(null);
  const hoveredCellRef = useRef<{ rowId: string; hour: number } | null>(null);
  const dirtyRef = useRef(true);

  // ───── Animations (move/resize/appear/delete) ─────
  const taskAnimationsRef = useRef<Map<string, TaskAnim>>(new Map());
  const prevTaskIdsRef = useRef<Set<string> | null>(null);

  const startMoveAnim = useCallback(
    (taskId: string, fromX: number, fromY: number, toX: number, toY: number) => {
      taskAnimationsRef.current.set(taskId, {
        kind: "move",
        startTime: performance.now(),
        duration: ANIM_DURATIONS.move,
        easing: easeOutExpo,
        offsetX: fromX - toX,
        offsetY: fromY - toY,
      });
      dirtyRef.current = true;
    },
    []
  );
  const startResizeAnim = useCallback(
    (taskId: string, fromX: number, fromWidth: number, toX: number, toWidth: number) => {
      taskAnimationsRef.current.set(taskId, {
        kind: "resize",
        startTime: performance.now(),
        duration: ANIM_DURATIONS.resize,
        easing: easeOutQuart,
        offsetX: fromX - toX,
        offsetWidth: fromWidth - toWidth,
      });
      dirtyRef.current = true;
    },
    []
  );
  const startAppearAnim = useCallback((taskId: string) => {
    taskAnimationsRef.current.set(taskId, {
      kind: "appear",
      startTime: performance.now(),
      duration: ANIM_DURATIONS.appear,
      easing: easeOutBack,
    });
    dirtyRef.current = true;
  }, []);
  const startDeleteAnim = useCallback((taskId: string) => {
    taskAnimationsRef.current.set(taskId, {
      kind: "delete",
      startTime: performance.now(),
      duration: ANIM_DURATIONS.delete,
      easing: easeInQuad,
    });
    dirtyRef.current = true;
  }, []);
  const cancelTaskAnim = useCallback((taskId: string) => {
    taskAnimationsRef.current.delete(taskId);
  }, []);

  // ───── Dialogs ─────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [prefillData, setPrefillData] = useState<{
    rowId?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [multiDeleteState, setMultiDeleteState] = useState<{ taskId: string; rowId: string } | null>(null);
  const [recurDeleteState, setRecurDeleteState] = useState<{ taskId: string; rowId?: string } | null>(null);
  const [pendingRecurScope, setPendingRecurScope] = useState<{ taskId: string; scope: "single" | "all" | "before" | "after" } | null>(null);

  // ───── Tooltip controlled ─────
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [hoveredSidebarRowId, setHoveredSidebarRowId] = useState<string | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState({ x: 0, top: 0, bottom: 0 });
  // Closes any current tooltip — used by the scrollbars' `onPointerEnter`
  // (overlay above the canvas) since the canvas pointermove no longer
  // fires once the mouse leaves the canvas to enter the
  // scrollbar area.
  const clearTooltip = useCallback(() => {
    if (hoveredTaskIdRef.current !== null) hoveredTaskIdRef.current = null;
    setHoveredTaskId(null);
    setHoveredSidebarRowId(null);
  }, []);
  const hoveredTask = hoveredTaskId ? taskIndex.get(hoveredTaskId.includes(":") ? hoveredTaskId.split(":")[0] : hoveredTaskId) ?? null : null;
  const hoveredSidebarRow = hoveredSidebarRowId
    ? sortedRows.find((r) => r.id === hoveredSidebarRowId && r.type !== "header")
    : null;

  // ───── DropActionMenu ─────
  const [dropInfo, setDropInfo] = useState<{
    taskId: string;
    sourceRowId: string;
    targetRowId: string | null;
    newStartTime: string;
    newEndTime: string;
    deltaHours: number;
    dropPosition: { x: number; y: number };
  } | null>(null);
  const clearDrop = useCallback(() => setDropInfo(null), []);

  // ───── Mini-feedback Ctrl+C/X/V ─────
  const [clipFeedback, setClipFeedback] = useState<{
    type: "copy" | "cut" | "paste";
    x: number;
    y: number;
    key: number;
  } | null>(null);
  const mousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const showClipFeedback = useCallback((type: "copy" | "cut" | "paste") => {
    const pos = mousePosRef.current;
    if (!pos) return;
    setClipFeedback({ type, x: pos.clientX, y: pos.clientY, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!clipFeedback) return;
    const t = window.setTimeout(() => setClipFeedback(null), 1100);
    return () => window.clearTimeout(t);
  }, [clipFeedback]);

  // ───── Theme resync ─────
  const { resolvedTheme } = useTheme();
  useEffect(() => { dirtyRef.current = true; }, [resolvedTheme]);

  // ───── Auto-trigger "appear" anim on new IDs ─────
  useEffect(() => {
    const currentIds = new Set(dayTasks.map((t) => t.id));
    const prev = prevTaskIdsRef.current;
    if (prev !== null) {
      // Skip the 1st render (otherwise every existing task
      // triggers an anim when the component mounts).
      // Detects an optimistic that just disappeared: the task
      // appearing in its place is the server replacement (same
      // entity), not a new creation → skip its anim
      // to avoid flicker (optimistic anim → replacement
      // → 2nd anim on the real task).
      let optimisticDisappeared = false;
      for (const id of prev) {
        if (isOptimisticId(id) && !currentIds.has(id)) {
          optimisticDisappeared = true;
          break;
        }
      }
      for (const id of currentIds) {
        if (prev.has(id)) continue;
        if (isOptimisticId(id)) continue; // the optimistic itself does not animate (instant appearance)
        if (optimisticDisappeared) continue; // server replacement → no 2nd anim
        startAppearAnim(id);
      }
    }
    prevTaskIdsRef.current = currentIds;
  }, [dayTasks, startAppearAnim]);

  // ───── Hit-test ─────
  type HitResult =
    | { kind: "task"; taskId: string; rowId: string; subzone: "body" | "resize-left" | "resize-right"; barTop: number; barBottom: number }
    | { kind: "cell"; rowId: string; hour: number }
    | { kind: "header" }
    | { kind: "sidebar"; rowId: string }
    | { kind: "none" };

  const hitTest = useCallback(
    (x: number, y: number): HitResult => {
      if (y < HEADER_TOTAL_HEIGHT) return { kind: "header" };
      if (x < computedSidebarWidth) {
        const yRel = y - HEADER_TOTAL_HEIGHT + scrollY;
        for (const ar of allocatedRows) {
          if (ar.row.type === "header") continue;
          if (yRel >= ar.y && yRel < ar.y + ar.height) return { kind: "sidebar", rowId: ar.row.id };
        }
        return { kind: "none" };
      }
      const xRel = x - computedSidebarWidth + scrollX;
      const slotIdx = Math.floor(xRel / slotWidth);
      const slot = slots[slotIdx];
      if (!slot) return { kind: "none" };
      const yRel = y - HEADER_TOTAL_HEIGHT + scrollY;
      for (const ar of allocatedRows) {
        if (ar.row.type === "header") continue;
        if (yRel < ar.y || yRel >= ar.y + ar.height) continue;
        for (const t of ar.tasks) {
          const r = getBarRect(t, ar, scrollX, scrollY);
          if (!r) continue;
          if (x < r.x || x >= r.x + r.width || y < r.y || y >= r.y + r.height) continue;
          // Subzone: resize-left / resize-right / body. All-day tasks
          // (no startTime) are not resizable in the hours view —
          // they stay in "body" mode only (drag/move/click ok).
          // Locked or non-resizable task (`tasks:resize`
          // permission disabled or insufficient scope): no resize zone
          // detected → cursor stays "pointer", parity with
          // the days view.
          const taskRef = taskIndex.get(t.id.includes(":") ? t.id.split(":")[0] : t.id);
          const isAllDay = taskRef ? !taskRef.startTime : false;
          const isLocked = !!taskRef?.isLocked;
          const canResize = !taskRef ? true : canResizeTaskFn(taskRef);
          let subzone: "body" | "resize-left" | "resize-right" = "body";
          if (!isAllDay && !isLocked && canResize) {
            if (x - r.x < RESIZE_HANDLE_WIDTH) subzone = "resize-left";
            else if (r.x + r.width - x < RESIZE_HANDLE_WIDTH) subzone = "resize-right";
          }
          return {
            kind: "task",
            taskId: t.id,
            rowId: ar.row.id,
            subzone,
            barTop: r.y,
            barBottom: r.y + r.height,
          };
        }
        return { kind: "cell", rowId: ar.row.id, hour: slot.hour };
      }
      return { kind: "none" };
    },
    [allocatedRows, slots, slotWidth, scrollX, scrollY, getBarRect, taskIndex, canResizeTaskFn]
  );

  // ───── Pointer events ─────
  useEffect(() => {
    const canvas = interactiveCanvas;
    if (!canvas || !containerNode) return;

    const getCoords = (e: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const pointer = {
      down: false,
      activated: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      hitTarget: null as HitResult | null,
      isContextMenu: false,
      pointerType: "mouse" as string,
      panActive: false,
      lastX: 0,
      lastY: 0,
    };

    const handleDown = (e: PointerEvent) => {
      if (contextMenu) {
        setContextMenu(null);
        e.preventDefault();
        return;
      }
      // Same for the DropActionMenu: the 1st click closes it, without
      // directly opening the task dialog.
      if (dropInfo) {
        clearDrop();
        e.preventDefault();
        return;
      }
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      pointer.isContextMenu = e.button === 2;
      if (e.button !== 0 && e.button !== 2) return;
      const { x, y } = getCoords(e);
      const t = hitTest(x, y);
      pointer.down = true;
      pointer.pointerId = e.pointerId;
      pointer.startX = e.clientX;
      pointer.startY = e.clientY;
      pointer.lastX = e.clientX;
      pointer.lastY = e.clientY;
      pointer.activated = false;
      pointer.hitTarget = t;
      pointer.panActive = false;
      pointer.pointerType = e.pointerType || "mouse";
      if (e.button === 0 && t.kind === "task") {
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    };

    const handleMove = (e: PointerEvent) => {
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      const { x, y } = getCoords(e);
      // Hover outside drag
      if (!pointer.down) {
        const t = hitTest(x, y);
        const newHovered = t.kind === "task" ? t.taskId : null;
        if (hoveredTaskIdRef.current !== newHovered) {
          hoveredTaskIdRef.current = newHovered;
          // Redraw needed to apply the brightness + resize handles.
          dirtyRef.current = true;
        }
        // Cell hover (translucent background overlay, parity with days)
        const newCell = t.kind === "cell" ? { rowId: t.rowId, hour: t.hour } : null;
        const cur = hoveredCellRef.current;
        const cellChanged = !!(
          (cur === null && newCell !== null) ||
          (cur !== null && newCell === null) ||
          (cur && newCell && (cur.rowId !== newCell.rowId || cur.hour !== newCell.hour))
        );
        if (cellChanged) {
          hoveredCellRef.current = newCell;
          dirtyRef.current = true;
        }
        if (t.kind === "task") {
          if (hoveredTaskId !== t.taskId) setHoveredTaskId(t.taskId);
          if (hoveredSidebarRowId !== null) setHoveredSidebarRowId(null);
          const rect = canvas.getBoundingClientRect();
          setTooltipAnchor({ x: e.clientX, top: rect.top + t.barTop, bottom: rect.top + t.barBottom });
        } else if (t.kind === "sidebar") {
          if (hoveredSidebarRowId !== t.rowId) setHoveredSidebarRowId(t.rowId);
          if (hoveredTaskId !== null) setHoveredTaskId(null);
          const ar = allocatedRows.find((r) => r.row.id === t.rowId);
          if (ar) {
            const rect = canvas.getBoundingClientRect();
            const yTop = HEADER_TOTAL_HEIGHT + ar.y - scrollY;
            setTooltipAnchor({ x: 0, top: rect.top + yTop, bottom: rect.top + yTop + ar.height });
          }
        } else {
          if (hoveredTaskId !== null) setHoveredTaskId(null);
          if (hoveredSidebarRowId !== null) setHoveredSidebarRowId(null);
        }
        // Cursor
        // Cursors aligned with the days canvas: ew-resize on handles,
        // pointer on bar / creatable cell, default elsewhere.
        if (t.kind === "task" && (t.subzone === "resize-left" || t.subzone === "resize-right")) {
          canvas.style.cursor = "ew-resize";
        } else if (t.kind === "task") {
          canvas.style.cursor = "pointer";
        } else if (t.kind === "cell") {
          canvas.style.cursor = "pointer";
        } else {
          canvas.style.cursor = "default";
        }
        return;
      }
      // Drag tracking
      const dx = e.clientX - pointer.startX;
      const dy = e.clientY - pointer.startY;
      const distSq = dx * dx + dy * dy;
      // Touch pan (mobile) on cell or none or even task (drag disabled on touch)
      if (!pointer.activated && pointer.pointerType === "touch") {
        if (distSq < DRAG_ACTIVATION_DISTANCE ** 2) return;
        pointer.activated = true;
        pointer.panActive = true;
        pointer.lastX = e.clientX;
        pointer.lastY = e.clientY;
        return;
      }
      if (pointer.panActive) {
        const ddx = e.clientX - pointer.lastX;
        const ddy = e.clientY - pointer.lastY;
        pointer.lastX = e.clientX;
        pointer.lastY = e.clientY;
        const { maxX, maxY } = gridScrollBounds(
          totalGridWidth,
          totalContentHeight,
          size.width - computedSidebarWidth,
          size.height - HEADER_TOTAL_HEIGHT,
          !isTouchDevice,
        );
        setScrollX((p) => Math.max(0, Math.min(maxX, p - ddx)));
        setScrollY((p) => Math.max(0, Math.min(maxY, p - ddy)));
        return;
      }
      // Desktop drag: activation after distance
      if (!pointer.activated) {
        if (distSq < DRAG_ACTIVATION_DISTANCE ** 2) return;
        if (pointer.hitTarget?.kind !== "task") return;
        const t = pointer.hitTarget;
        const taskAlloc = allocatedRows
          .flatMap((ar) => ar.tasks.map((ta) => ({ ar, ta })))
          .find((x) => x.ta.id === t.taskId);
        if (!taskAlloc) return;
        const realId = t.taskId.includes(":") ? t.taskId.split(":")[0] : t.taskId;
        const task = taskIndex.get(realId);
        if (!task) return;
        const isResize = t.subzone === "resize-left" || t.subzone === "resize-right";
        // Permission gates (drag/resize fully disabled on mobile —
        // the user only has click to open/create, swipe scrolls the grid).
        const canDrag = !isTouchDevice && task.isLocked !== true && (canMoveTask(task) || canCreateAnyTask);
        const canResize = !isTouchDevice && task.isLocked !== true && canResizeTask(task);
        if ((isResize && !canResize) || (!isResize && !canDrag)) return;
        pointer.activated = true;
        isDragActiveRef.current = true;
        dragStateRef.current = {
          active: true,
          taskId: t.taskId,
          mode: t.subzone === "resize-left" ? "resize-left" : t.subzone === "resize-right" ? "resize-right" : "move",
          startX: pointer.startX,
          startY: pointer.startY,
          pointerX: e.clientX,
          pointerY: e.clientY,
          deltaHours: 0,
          targetRowId: t.rowId,
          sourceRowId: t.rowId,
          // Snapshot of the source coords: used by drawDragPreview
          // so it is not disturbed by the optimistic cache update.
          originStartMin: taskAlloc.ta.startMin,
          originEndMin: taskAlloc.ta.endMin,
          originSlot: taskAlloc.ta.slot,
        };
        dirtyRef.current = true;
      }
      const drag = dragStateRef.current;
      if (drag.active) {
        const ddx = e.clientX - drag.startX;
        const newDeltaHours = Math.round(ddx / slotWidth);
        const target = hitTest(x, y);
        if (target.kind === "cell" || target.kind === "task") {
          drag.targetRowId = target.kind === "cell" ? target.rowId : target.rowId;
        }
        drag.deltaHours = newDeltaHours;
        drag.pointerX = e.clientX;
        drag.pointerY = e.clientY;
        dirtyRef.current = true;
      }
    };

    const handleUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!pointer.down) return;
      if (pointer.panActive) {
        pointer.panActive = false;
        pointer.down = false;
        pointer.activated = false;
        return;
      }
      const wasActivated = pointer.activated;
      const target = pointer.hitTarget;
      pointer.down = false;
      pointer.activated = false;

      if (pointer.isContextMenu && target) {
        if (target.kind === "task") {
          const realId = target.taskId.includes(":") ? target.taskId.split(":")[0] : target.taskId;
          setContextMenu({ x: e.clientX, y: e.clientY, taskId: realId, rowId: target.rowId });
        } else if (target.kind === "cell") {
          setContextMenu({ x: e.clientX, y: e.clientY, rowId: target.rowId, dateStr, hour: target.hour });
        }
        pointer.isContextMenu = false;
        return;
      }

      const drag = dragStateRef.current;
      if (wasActivated && drag.active && drag.taskId) {
        const realId = drag.taskId.includes(":") ? drag.taskId.split(":")[0] : drag.taskId;
        const task = taskIndex.get(realId);
        if (task) {
          if (drag.mode === "move" && drag.deltaHours !== 0) {
            // Compute new startTime/endTime
            const startH = task.startTime ? parseInt(task.startTime.split(":")[0], 10) : firstHour;
            const startM = task.startTime ? parseInt(task.startTime.split(":")[1] || "0", 10) : 0;
            const endH = task.endTime ? parseInt(task.endTime.split(":")[0], 10) : lastHour;
            const endM = task.endTime ? parseInt(task.endTime.split(":")[1] || "0", 10) : 0;
            const newStartH = Math.max(0, Math.min(23, startH + drag.deltaHours));
            const newEndH = Math.max(newStartH + 1, Math.min(24, endH + drag.deltaHours));
            const newStartTime = `${String(newStartH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
            const newEndTime = `${String(newEndH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
            setDropInfo({
              taskId: realId,
              sourceRowId: drag.sourceRowId,
              targetRowId: drag.targetRowId,
              newStartTime,
              newEndTime,
              deltaHours: drag.deltaHours,
              dropPosition: { x: e.clientX, y: e.clientY },
            });
            // Immediate drag clear so the transparent ghost
            // (pass 3.5) shows at the target position as soon as the
            // menu opens — without the 150 ms hold that delayed display.
            // The mutate has not fired yet (waits for the menu decision),
            // so no risk of an optimistic flash.
            isDragActiveRef.current = false;
            dragStateRef.current = { ...INITIAL_DRAG };
            dirtyRef.current = true;
            return;
          } else if ((drag.mode === "resize-left" || drag.mode === "resize-right") && drag.deltaHours !== 0) {
            // Direct resize (no Move/Copy menu)
            const startH = task.startTime ? parseInt(task.startTime.split(":")[0], 10) : firstHour;
            const startM = task.startTime ? parseInt(task.startTime.split(":")[1] || "0", 10) : 0;
            const endH = task.endTime ? parseInt(task.endTime.split(":")[0], 10) : lastHour;
            const endM = task.endTime ? parseInt(task.endTime.split(":")[1] || "0", 10) : 0;
            let newStartH = startH;
            let newEndH = endH;
            if (drag.mode === "resize-left") newStartH = Math.max(0, startH + drag.deltaHours);
            else newEndH = Math.min(24, endH + drag.deltaHours);
            if (newStartH < newEndH) {
              // "resize" anim: interpolates width from the current size
              // to the future size. dx in pixels = deltaHours * slotWidth.
              const sourceEntry = allocatedRows
                .flatMap((ar) => ar.tasks.map((ta) => ({ ar, ta })))
                .find((x) => x.ta.id === drag.taskId);
              if (sourceEntry) {
                const fromRect = getBarRect(sourceEntry.ta, sourceEntry.ar, scrollX, scrollY);
                if (fromRect) {
                  const dx = drag.deltaHours * slotWidth;
                  const toX = drag.mode === "resize-left" ? fromRect.x + dx : fromRect.x;
                  const toW = drag.mode === "resize-left"
                    ? Math.max(slotWidth - 4, fromRect.width - dx)
                    : Math.max(slotWidth - 4, fromRect.width + dx);
                  startResizeAnim(realId, fromRect.x, fromRect.width, toX, toW);
                }
              }
              const newStartTime = `${String(newStartH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
              const newEndTime = `${String(newEndH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
              resizeTask.mutate({
                id: realId,
                data: {
                  startDate: task.startDate,
                  endDate: task.endDate ?? task.startDate,
                  startTime: newStartTime,
                  endTime: newEndTime,
                },
              });
            }
          }
        }
        // Short hold before clearing (gives the cache time to update)
        setTimeout(() => {
          isDragActiveRef.current = false;
          dragStateRef.current = { ...INITIAL_DRAG };
          dirtyRef.current = true;
        }, 150);
        return;
      }

      // Simple click
      if (target?.kind === "task") {
        if (target.taskId.startsWith("va:") || target.taskId.startsWith("ra:")) return;
        const realId = target.taskId.includes(":") ? target.taskId.split(":")[0] : target.taskId;
        setEditingTaskId(realId);
        setPrefillData(null);
        setDialogOpen(true);
      } else if (target?.kind === "cell") {
        if (!canCreateAnyTask) return;
        const row = sortedRows.find((r) => r.id === target.rowId);
        if (row && row.type === "row" && !canCreateOnPlanningRow(viewMode, row as GridRow)) return;
        if (viewMode === "users" && dailyLimit > 0) {
          if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [target.rowId], startDate: dateStr })) return;
        }
        const startTime = `${String(target.hour).padStart(2, "0")}:00`;
        const endTime = `${String(target.hour + 1).padStart(2, "0")}:00`;
        setEditingTaskId(null);
        setPrefillData({ rowId: target.rowId, date: dateStr, startTime, endTime });
        setDialogOpen(true);
      }
    };

    const handleCancel = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      pointer.down = false;
      pointer.activated = false;
      pointer.panActive = false;
      isDragActiveRef.current = false;
      dragStateRef.current = { ...INITIAL_DRAG };
      dirtyRef.current = true;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { maxX, maxY } = gridScrollBounds(
        totalGridWidth,
        totalContentHeight,
        size.width - computedSidebarWidth,
        size.height - HEADER_TOTAL_HEIGHT,
        !isTouchDevice,
      );
      setScrollX((p) => Math.max(0, Math.min(maxX, p + e.deltaX)));
      setScrollY((p) => Math.max(0, Math.min(maxY, p + e.deltaY)));
    };

    const handleLeave = () => {
      if (hoveredTaskId !== null) setHoveredTaskId(null);
      if (hoveredCellRef.current !== null) {
        hoveredCellRef.current = null;
        dirtyRef.current = true;
      }
      if (hoveredTaskIdRef.current !== null) {
        hoveredTaskIdRef.current = null;
        dirtyRef.current = true;
      }
      if (hoveredSidebarRowId !== null) setHoveredSidebarRowId(null);
    };

    const handleContextMenuNative = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("pointerdown", handleDown);
    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerup", handleUp);
    canvas.addEventListener("pointercancel", handleCancel);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenuNative);
    containerNode.addEventListener("pointerleave", handleLeave);
    return () => {
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", handleUp);
      canvas.removeEventListener("pointercancel", handleCancel);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("contextmenu", handleContextMenuNative);
      containerNode.removeEventListener("pointerleave", handleLeave);
    };
  }, [
    interactiveCanvas,
    containerNode,
    hitTest,
    contextMenu,
    dropInfo,
    clearDrop,
    isTouchDevice,
    hoveredTaskId,
    hoveredSidebarRowId,
    canCreateAnyTask,
    canCreateOnPlanningRow,
    canMoveTask,
    canResizeTask,
    viewMode,
    sortedRows,
    dailyLimit,
    tasks,
    dateStr,
    totalGridWidth,
    totalContentHeight,
    size.width,
    size.height,
    slotWidth,
    allocatedRows,
    taskIndex,
    firstHour,
    lastHour,
    resizeTask,
    startResizeAnim,
  ]);

  // ───── Drop handlers (Move / MoveUser / Copy / AddUser) ─────
  const handleDropMove = useCallback(() => {
    if (!dropInfo) return;
    const sourceTask = taskIndex.get(dropInfo.taskId);
    const isMulti = (sourceTask?.users?.length ?? 0) > 1;
    // Immediate drag clear: otherwise the next rAF tick still marks
    // the bar as isDragSource → ghost alpha 0.35 for 150 ms,
    // which shows as a flicker on drop. Parity with the days canvas.
    isDragActiveRef.current = false;
    dragStateRef.current = { ...INITIAL_DRAG };
    // "move" anim: interpolates the bar from the current position to the
    // future position in pixels. The toRect computation anticipates the hour snap.
    {
      const sourceEntry = allocatedRows
        .flatMap((ar) => ar.tasks.map((ta) => ({ ar, ta })))
        .find((x) => x.ta.id === dropInfo.taskId);
      if (sourceEntry) {
        const fromRect = getBarRect(sourceEntry.ta, sourceEntry.ar, scrollX, scrollY);
        if (fromRect) {
          const newStartH = parseInt(dropInfo.newStartTime.split(":")[0], 10);
          const newEndH = parseInt(dropInfo.newEndTime.split(":")[0], 10);
          const startIdx = findSlotIdx(newStartH);
          const finalEndIdx = findSlotIdx(Math.max(newStartH, newEndH - 1));
          if (startIdx >= 0 && finalEndIdx >= 0) {
            const toX = computedSidebarWidth + startIdx * slotWidth - scrollX + 2;
            let toY = fromRect.y;
            if (dropInfo.targetRowId && dropInfo.targetRowId !== dropInfo.sourceRowId) {
              const targetAr = allocatedRows.find((ar) => ar.row.id === dropInfo.targetRowId);
              if (targetAr) {
                toY = HEADER_TOTAL_HEIGHT + targetAr.y - scrollY + sourceEntry.ta.slot * (barH + TASK_BAR_GAP) + ROW_PADDING;
              }
            }
            startMoveAnim(dropInfo.taskId, fromRect.x, fromRect.y, toX, toY);
          }
        }
      }
    }
    let dropFields: Record<string, unknown> = {};
    if (viewMode === "users" && dropInfo.targetRowId && dropInfo.targetRowId !== dropInfo.sourceRowId) {
      if (isMulti) {
        const cur = sourceTask?.users?.map((u) => u.id) ?? [];
        dropFields = { userIds: Array.from(new Set([...cur, dropInfo.targetRowId])) };
      } else {
        dropFields = { userIds: [dropInfo.targetRowId] };
      }
    }
    moveTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dateStr,
        endDate: dateStr,
        startTime: dropInfo.newStartTime,
        endTime: dropInfo.newEndTime,
        ...dropFields,
      },
    });
    clearDrop();
  }, [dropInfo, taskIndex, viewMode, moveTask, dateStr, clearDrop, allocatedRows, getBarRect, scrollX, scrollY, findSlotIdx, slotWidth, startMoveAnim]);

  const handleDropMoveUser = useCallback(() => {
    if (!dropInfo || !dropInfo.sourceRowId) return;
    isDragActiveRef.current = false;
    dragStateRef.current = { ...INITIAL_DRAG };
    const sourceUserId = dropInfo.sourceRowId;
    removeUserMutation.mutate({ taskId: dropInfo.taskId, userId: sourceUserId });
    copyTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dateStr,
        startTime: dropInfo.newStartTime,
        endTime: dropInfo.newEndTime,
        userIds: [sourceUserId],
      },
    });
    clearDrop();
  }, [dropInfo, removeUserMutation, copyTask, dateStr, clearDrop]);

  const handleDropCopy = useCallback(() => {
    if (!dropInfo) return;
    isDragActiveRef.current = false;
    dragStateRef.current = { ...INITIAL_DRAG };
    const targetUser = dropInfo.targetRowId && viewMode === "users" ? [dropInfo.targetRowId] : undefined;
    copyTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dateStr,
        startTime: dropInfo.newStartTime,
        endTime: dropInfo.newEndTime,
        ...(targetUser ? { userIds: targetUser } : {}),
      },
    });
    clearDrop();
  }, [dropInfo, viewMode, copyTask, dateStr, clearDrop]);

  const handleDropAddUser = useCallback(() => {
    if (!dropInfo || !dropInfo.targetRowId) return;
    isDragActiveRef.current = false;
    dragStateRef.current = { ...INITIAL_DRAG };
    const sourceTask = taskIndex.get(dropInfo.taskId);
    const cur = sourceTask?.users?.map((u) => u.id) ?? [];
    const merged = Array.from(new Set([...cur, dropInfo.targetRowId]));
    updateTask.mutate({ id: dropInfo.taskId, data: { userIds: merged } });
    clearDrop();
  }, [dropInfo, taskIndex, updateTask, clearDrop]);

  // ───── Context menu handlers ─────
  const handleEditTask = useCallback((taskId: string) => {
    setEditingTaskId(taskId);
    setPrefillData(null);
    setDialogOpen(true);
  }, []);
  const handleCopyTaskClip = useCallback(
    (taskId: string) => {
      if (!canCreateAnyTask) return;
      setClipboard(taskId, "copy");
      showClipFeedback("copy");
    },
    [setClipboard, showClipFeedback, canCreateAnyTask]
  );
  const handleCutTaskClip = useCallback(
    (taskId: string) => {
      const realId = taskId.includes(":") ? taskId.split(":")[0] : taskId;
      const task = taskIndex.get(realId);
      if (!task || task.isLocked || !canMoveTask(task)) return;
      setClipboard(taskId, "cut");
      showClipFeedback("cut");
    },
    [setClipboard, showClipFeedback, taskIndex, canMoveTask]
  );
  const handleDeleteTaskAction = useCallback(
    (taskId: string, rowId?: string) => {
      const realId = taskId.includes(":") ? taskId.split(":")[0] : taskId;
      const task = taskIndex.get(realId);
      if (!task || task.isLocked || !canDeleteTask(task)) return;
      if (task.parentId) {
        setRecurDeleteState({ taskId: realId, rowId });
        return;
      }
      if ((task.users?.length ?? 0) > 1 && rowId) {
        setMultiDeleteState({ taskId: realId, rowId });
        return;
      }
      if (editingTaskId === realId) setEditingTaskId(null);
      startDeleteAnim(realId);
      setTimeout(() => deleteTask.mutate({ id: realId }), 130);
    },
    [deleteTask, taskIndex, canDeleteTask, editingTaskId, startDeleteAnim]
  );
  const handleLockTaskAction = useCallback(
    (taskId: string) => {
      const t = taskIndex.get(taskId);
      if (!t || !canLockTask(t)) return;
      updateTask.mutate({ id: taskId, data: { isLocked: !t.isLocked } });
    },
    [updateTask, taskIndex, canLockTask]
  );
  const handleCreateAtCell = useCallback(
    (rowId: string, dateStrArg: string, hour?: number) => {
      if (!canCreateAnyTask) return;
      const row = sortedRows.find((r) => r.id === rowId);
      if (row && row.type === "row" && !canCreateOnPlanningRow(viewMode, row as GridRow)) return;
      if (viewMode === "users" && dailyLimit > 0) {
        if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [rowId], startDate: dateStrArg })) return;
      }
      const h = hour ?? firstHour;
      const startTime = `${String(h).padStart(2, "0")}:00`;
      const endTime = `${String(h + 1).padStart(2, "0")}:00`;
      setEditingTaskId(null);
      setPrefillData({ rowId, date: dateStrArg, startTime, endTime });
      setDialogOpen(true);
    },
    [canCreateAnyTask, sortedRows, canCreateOnPlanningRow, viewMode, dailyLimit, tasks, firstHour]
  );
  const handlePasteAtCell = useCallback(
    (rowId: string, dateStrArg: string, hour?: number) => {
      if (!clipboardTask) return;
      const source = taskIndex.get(clipboardTask.taskId);
      if (!source) {
        clearClipboard();
        return;
      }
      if (clipboardTask.mode === "copy") {
        if (!canCreateAnyTask) return;
      } else {
        if (source.isLocked || !canMoveTask(source)) return;
      }
      const destRow = sortedRows.find((r) => r.id === rowId);
      if (destRow && destRow.type === "row" && !canCreateOnPlanningRow(viewMode, destRow as GridRow)) return;
      if (viewMode === "users" && dailyLimit > 0) {
        if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [rowId], startDate: dateStrArg })) return;
      }
      const h = hour ?? (source.startTime ? parseInt(source.startTime.split(":")[0], 10) : firstHour);
      const origStartH = source.startTime ? parseInt(source.startTime.split(":")[0], 10) : firstHour;
      const origEndH = source.endTime ? parseInt(source.endTime.split(":")[0], 10) : lastHour;
      const dur = origEndH - origStartH;
      const newStartTime = `${String(h).padStart(2, "0")}:00`;
      const newEndTime = `${String(h + dur).padStart(2, "0")}:00`;
      const rowFields = viewMode === "users" ? { userIds: [rowId] } :
        viewMode === "projects" ? { projectId: rowId } :
        viewMode === "places" ? { placeId: rowId } :
        viewMode === "resources" ? { resourceId: rowId } : {};
      if (clipboardTask.mode === "copy") {
        copyTask.mutate({
          id: clipboardTask.taskId,
          data: { startDate: dateStrArg, startTime: newStartTime, endTime: newEndTime, ...rowFields },
        });
      } else {
        moveTask.mutate({
          id: clipboardTask.taskId,
          data: { startDate: dateStrArg, endDate: dateStrArg, startTime: newStartTime, endTime: newEndTime, ...rowFields },
        });
        clearClipboard();
      }
      showClipFeedback("paste");
    },
    [clipboardTask, taskIndex, canCreateAnyTask, canMoveTask, sortedRows, canCreateOnPlanningRow, viewMode, dailyLimit, tasks, firstHour, lastHour, copyTask, moveTask, clearClipboard, showClipFeedback]
  );

  // ───── Ctrl+C/X/V shortcuts ─────
  useEffect(() => {
    if (!interactiveCanvas) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;
      const pos = mousePosRef.current;
      if (!pos) return;
      const rect = interactiveCanvas.getBoundingClientRect();
      const x = pos.clientX - rect.left;
      const y = pos.clientY - rect.top;
      const t = hitTest(x, y);
      if (key === "c" && t.kind === "task") {
        e.preventDefault();
        const realId = t.taskId.includes(":") ? t.taskId.split(":")[0] : t.taskId;
        handleCopyTaskClip(realId);
      } else if (key === "x" && t.kind === "task") {
        e.preventDefault();
        const realId = t.taskId.includes(":") ? t.taskId.split(":")[0] : t.taskId;
        handleCutTaskClip(realId);
      } else if (key === "v" && t.kind === "cell" && clipboardTask) {
        e.preventDefault();
        handlePasteAtCell(t.rowId, dateStr, t.hour);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactiveCanvas, hitTest, handleCopyTaskClip, handleCutTaskClip, handlePasteAtCell, clipboardTask, dateStr]);

  // ───── Render loops ─────
  useEffect(() => {
    dirtyRef.current = true;
  }, [allocatedRows, slots, slotWidth, scrollX, scrollY, size, totalContentHeight, totalGridWidth, showRowAvatar, dropInfo, contextMenu]);

  useEffect(() => {
    const sCanvas = staticCanvas;
    const iCanvas = interactiveCanvas;
    if (!sCanvas || !iCanvas) return;
    const sCtx = sCanvas.getContext("2d");
    const iCtx = iCanvas.getContext("2d");
    if (!sCtx || !iCtx) return;
    let raf = 0;
    const tick = () => {
      const drag = dragStateRef.current;
      const isInteractiveDirty = drag.active || isDragActiveRef.current;
      // Cleanup of finished anims + dirty flag if an anim is still active.
      const now = performance.now();
      let hasActiveAnim = false;
      const anims = taskAnimationsRef.current;
      if (anims.size > 0) {
        for (const [id, a] of anims) {
          if (isAnimDone(a, now)) anims.delete(id);
          else hasActiveAnim = true;
        }
        if (hasActiveAnim) dirtyRef.current = true;
      }
      if (dirtyRef.current) {
        drawStatic(sCtx, {
          size, scrollX, scrollY, slots, slotWidth, allocatedRows,
          totalContentHeight, dateStr, selectedDay, showAvatar: showRowAvatar !== false,
          dragState: drag, getBarRect, taskIndex,
          taskAnimations: anims,
          hoveredTaskId: hoveredTaskIdRef.current,
          hoveredCell: hoveredCellRef.current,
          viewMode,
          sidebarWidth: computedSidebarWidth,
          barH, fontFamily, cellFontSize, fontBold,
          canResizeTask: canResizeTaskFn,
          untitled: untitledLabel,
          i18n: hoursI18n,
          pendingTaskId: dropInfo?.taskId ?? null,
          pendingDrop: dropInfo
            ? {
                taskId: dropInfo.taskId,
                targetRowId: dropInfo.targetRowId,
                sourceRowId: dropInfo.sourceRowId,
                newStartTime: dropInfo.newStartTime,
                newEndTime: dropInfo.newEndTime,
              }
            : null,
          isFetching,
        });
        // During a fetch, the skeleton wave must animate continuously
        // (otherwise it stays frozen until the next dirty trigger).
        if (isFetching) dirtyRef.current = true;
        dirtyRef.current = false;
      }
      // Interactive layer : drag preview
      iCtx.clearRect(0, 0, size.width || 1, size.height || 1);
      if (isInteractiveDirty && drag.taskId) {
        drawDragPreview(iCtx, {
          drag, slots, slotWidth, allocatedRows, scrollX, scrollY,
          getBarRect, taskIndex, viewMode, sidebarWidth: computedSidebarWidth,
          barH, fontFamily, cellFontSize, fontBold,
          canResizeTask: canResizeTaskFn,
          untitled: untitledLabel,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [staticCanvas, interactiveCanvas, size, scrollX, scrollY, slots, slotWidth, allocatedRows, totalContentHeight, dateStr, selectedDay, showRowAvatar, getBarRect, taskIndex, viewMode, dropInfo, isFetching, computedSidebarWidth, barH, fontFamily, cellFontSize, fontBold, canResizeTaskFn, untitledLabel, hoursI18n]);

  // ───── Menu/drop props computation ─────
  const ctxTask: TaskWithUsers | null = contextMenu?.taskId ? (taskIndex.get(contextMenu.taskId) ?? null) : null;
  const ctxRow: GridRow | null = contextMenu?.rowId ? ((sortedRows.find((r) => r.id === contextMenu.rowId) as GridRow) ?? null) : null;
  const menuCanCreate = (() => {
    if (!canCreateAnyTask) return false;
    if (ctxRow && ctxRow.type === "row" && !canCreateOnPlanningRow(viewMode, ctxRow)) return false;
    if (viewMode === "users" && contextMenu?.rowId && contextMenu.dateStr && dailyLimit > 0) {
      if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [contextMenu.rowId], startDate: contextMenu.dateStr })) return false;
    }
    return true;
  })();
  const menuCanEdit = (() => {
    if (!ctxTask) return modifyScope !== "readonly";
    if (ctxTask.isLocked) return false;
    return canModifyTask(ctxTask);
  })();
  const menuCanCopy = canCreateAnyTask;
  const menuCanCut = (() => {
    if (!ctxTask) return can("tasks:move");
    if (ctxTask.isLocked) return false;
    return canMoveTask(ctxTask);
  })();
  const menuCanDelete = (() => {
    if (!ctxTask) return can("tasks:delete");
    if (ctxTask.isLocked) return false;
    return canDeleteTask(ctxTask);
  })();
  const menuCanPaste = (() => {
    if (!clipboardTask) return false;
    const src = taskIndex.get(clipboardTask.taskId);
    if (clipboardTask.mode === "copy") {
      if (!canCreateAnyTask) return false;
    } else {
      if (!src || src.isLocked || !canMoveTask(src)) return false;
    }
    if (ctxRow && ctxRow.type === "row" && !canCreateOnPlanningRow(viewMode, ctxRow)) return false;
    return true;
  })();
  const menuCanLock = ctxTask ? canLockTask(ctxTask) : false;

  const dropSource: TaskWithUsers | null = dropInfo ? (taskIndex.get(dropInfo.taskId) ?? null) : null;
  const dropDestRow: GridRow | null = dropInfo?.targetRowId ? ((sortedRows.find((r) => r.id === dropInfo.targetRowId) as GridRow) ?? null) : null;
  const dropDestAllowed = !dropDestRow || dropDestRow.type !== "row" || canCreateOnPlanningRow(viewMode, dropDestRow);
  const dropCanMove = !!dropSource && canMoveTask(dropSource) && dropDestAllowed;
  const dropCanCopy = canCreateAnyTask && dropDestAllowed;

  // ───── Custom scrollbars (parity with the days canvas) ─────
  const MIN_THUMB = 36;
  const viewportContentW = Math.max(0, size.width - computedSidebarWidth);
  const viewportContentH = Math.max(0, size.height - HEADER_TOTAL_HEIGHT);
  const {
    maxX: maxScrollX,
    maxY: maxScrollY,
    showH: showHScrollbar,
    showV: showVScrollbar,
  } = gridScrollBounds(totalGridWidth, totalContentHeight, viewportContentW, viewportContentH, !isTouchDevice);
  // Horizontal track across the full grid width (names column
  // included), like the vertical track that covers the header.
  const hTrackW = Math.max(0, size.width - (showVScrollbar ? SCROLLBAR_SIZE : 0));
  // Vertical track across the full grid height (header included), like
  // a native scrollbar; only the scrollable content stays below the header.
  const vTrackH = Math.max(0, size.height - (showHScrollbar ? SCROLLBAR_SIZE : 0));
  const hThumbWidth = scrollThumbLength(viewportContentW, maxScrollX, hTrackW, MIN_THUMB);
  const hThumbX = maxScrollX === 0 ? 0 : (scrollX / maxScrollX) * (hTrackW - hThumbWidth);
  const vThumbHeight = scrollThumbLength(viewportContentH, maxScrollY, vTrackH, MIN_THUMB);
  const vThumbY = maxScrollY === 0 ? 0 : (scrollY / maxScrollY) * (vTrackH - vThumbHeight);

  const scrollbarDragRef = useRef<{ axis: "h" | "v"; startPointer: number; startScroll: number } | null>(null);
  const handleScrollbarPointerDown = useCallback(
    (axis: "h" | "v") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      scrollbarDragRef.current = {
        axis,
        startPointer: axis === "h" ? e.clientX : e.clientY,
        startScroll: axis === "h" ? scrollX : scrollY,
      };
      setIsScrollbarDragging(true);
    },
    [scrollX, scrollY]
  );
  const handleScrollbarPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = scrollbarDragRef.current;
      if (!drag) return;
      if (drag.axis === "h") {
        const trackLen = hTrackW - hThumbWidth;
        if (trackLen <= 0) return;
        const ratio = (e.clientX - drag.startPointer) / trackLen;
        setScrollX(Math.max(0, Math.min(maxScrollX, drag.startScroll + ratio * maxScrollX)));
      } else {
        const trackLen = vTrackH - vThumbHeight;
        if (trackLen <= 0) return;
        const ratio = (e.clientY - drag.startPointer) / trackLen;
        setScrollY(Math.max(0, Math.min(maxScrollY, drag.startScroll + ratio * maxScrollY)));
      }
    },
    [hTrackW, hThumbWidth, vTrackH, vThumbHeight, maxScrollX, maxScrollY]
  );
  const handleScrollbarPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    scrollbarDragRef.current = null;
    setIsScrollbarDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Initial skeleton handled by the parent (page.tsx) — when this component
  // mounts, the rows + 1st tasks response are already ready. The in-cell
  // skeleton wave keeps working for refetches.
  void isLoading;
  void isLoadingRows;
  void isLoadingTasks;
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {t("canvas.loadError", { message: (error as Error).message })}
      </div>
    );
  }

  return (
    <TooltipProvider skipDelayDuration={0}>
      <div
        className="flex h-full flex-col"
        style={{ "--sidebar-width": `${computedSidebarWidth}px` } as React.CSSProperties}
      >
        <GridToolbar
          onCreateTask={() => {
            setEditingTaskId(null);
            setPrefillData(null);
            setDialogOpen(true);
          }}
        />
        <div className="relative flex-1 overflow-hidden">
          <div ref={setContainerRef} className="relative h-full w-full overflow-hidden bg-background">
            <canvas
              ref={setStaticCanvas}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 1, pointerEvents: "none" }}
            />
            <canvas
              ref={setInteractiveCanvas}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 2, cursor: "default", touchAction: "none" }}
            />
            <CanvasTooltipAnchor ref={tooltipAnchorRef} />
            {hoveredTask && !isDragActiveRef.current && !isTouchDevice && contextMenu === null && dropInfo === null && (
              <TaskTooltip
                task={hoveredTask as Parameters<typeof TaskTooltip>[0]["task"]}
                project={hoveredTask.project}
                status={hoveredTask.statusId ? statusMap.get(hoveredTask.statusId) ?? null : null}
                viewMode={viewMode}
                controlled={{ visible: true, anchor: tooltipAnchor }}
              >
                <span style={{ display: "none" }} />
              </TaskTooltip>
            )}
            {hoveredSidebarRow && !isDragActiveRef.current && !isTouchDevice && contextMenu === null && dropInfo === null && (() => {
              const sidebarPos = {
                x: computedSidebarWidth + 8 + (containerNode?.getBoundingClientRect().left ?? 0),
                y: (tooltipAnchor.top + tooltipAnchor.bottom) / 2,
              };
              if (viewMode === "users") {
                return (
                  <UserTooltip
                    user={hoveredSidebarRow as Parameters<typeof UserTooltip>[0]["user"]}
                    controlled={{ visible: true, pos: sidebarPos }}
                  >
                    <span style={{ display: "none" }} />
                  </UserTooltip>
                );
              }
              if (viewMode === "projects") {
                return (
                  <ProjectTooltip
                    project={hoveredSidebarRow as Parameters<typeof ProjectTooltip>[0]["project"]}
                    controlled={{ visible: true, pos: sidebarPos }}
                  >
                    <span style={{ display: "none" }} />
                  </ProjectTooltip>
                );
              }
              return null;
            })()}
            {/* Horizontal scrollbar (overlay at the bottom, full width). */}
            {showHScrollbar && !isTouchDevice && (
              <div
                onPointerEnter={clearTooltip}
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  width: hTrackW,
                  height: SCROLLBAR_SIZE,
                  zIndex: 5,
                  // pointerEvents auto so that onPointerEnter fires.
                  pointerEvents: "auto",
                }}
                className="bg-muted border-t border-border"
              >
                <div
                  onPointerDown={handleScrollbarPointerDown("h")}
                  onPointerMove={handleScrollbarPointerMove}
                  onPointerUp={handleScrollbarPointerUp}
                  onPointerCancel={handleScrollbarPointerUp}
                  style={{
                    position: "absolute",
                    top: 2,
                    height: SCROLLBAR_SIZE - 4,
                    left: 0,
                    width: hThumbWidth,
                    transform: `translateX(${hThumbX}px)`,
                    touchAction: "none",
                    pointerEvents: "auto",
                  }}
                  className="rounded-full bg-foreground/50 hover:bg-foreground/70 active:bg-foreground/80 transition-colors"
                />
              </div>
            )}
            {/* Vertical scrollbar (overlay on the right, full grid height). */}
            {showVScrollbar && !isTouchDevice && (
              <div
                onPointerEnter={clearTooltip}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: SCROLLBAR_SIZE,
                  height: vTrackH,
                  zIndex: 5,
                  pointerEvents: "auto",
                }}
                className="bg-muted border-l border-border"
              >
                <div
                  onPointerDown={handleScrollbarPointerDown("v")}
                  onPointerMove={handleScrollbarPointerMove}
                  onPointerUp={handleScrollbarPointerUp}
                  onPointerCancel={handleScrollbarPointerUp}
                  style={{
                    position: "absolute",
                    left: 2,
                    width: SCROLLBAR_SIZE - 4,
                    top: 0,
                    height: vThumbHeight,
                    transform: `translateY(${vThumbY}px)`,
                    touchAction: "none",
                    pointerEvents: "auto",
                  }}
                  className="rounded-full bg-foreground/50 hover:bg-foreground/70 active:bg-foreground/80 transition-colors"
                />
              </div>
            )}
            {/* Corner filler when both scrollbars are visible. */}
            {showHScrollbar && showVScrollbar && !isTouchDevice && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  width: SCROLLBAR_SIZE,
                  height: SCROLLBAR_SIZE,
                  zIndex: 5,
                  pointerEvents: "none",
                }}
                className="bg-muted border-l border-t border-border"
              />
            )}
          </div>
        </div>
        <TaskFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          taskId={editingTaskId}
          prefill={prefillData}
          viewMode={viewMode}
        />
        {showSummary && (
          <div className="px-3 py-2 text-xs text-muted-foreground border-t">
            {t("summary.hoursTotal", { count: dayTasks.length })}
          </div>
        )}

        <DropActionMenu
          position={dropInfo?.dropPosition ?? null}
          isMultiUser={dropInfo ? (taskIndex.get(dropInfo.taskId)?.users?.length ?? 0) > 1 : false}
          canMove={dropCanMove}
          canCopy={dropCanCopy}
          onClose={clearDrop}
          onMove={handleDropMove}
          onMoveUser={viewMode === "users" ? handleDropMoveUser : undefined}
          onCopy={handleDropCopy}
          onAddUser={(() => {
            if (viewMode !== "users" || !dropInfo?.targetRowId) return undefined;
            if (dropInfo.targetRowId === dropInfo.sourceRowId) return undefined;
            const src = taskIndex.get(dropInfo.taskId);
            const isMulti = (src?.users?.length ?? 0) > 1;
            if (!isMulti) return undefined;
            const alreadyHas = src?.users?.some((u) => u.id === dropInfo.targetRowId);
            if (alreadyHas) return undefined;
            return handleDropAddUser;
          })()}
          addUserOnly={
            viewMode === "users" &&
            !!dropInfo &&
            dropInfo.deltaHours === 0 &&
            !!dropInfo.targetRowId &&
            dropInfo.targetRowId !== dropInfo.sourceRowId &&
            (taskIndex.get(dropInfo.taskId)?.users?.length ?? 0) > 1
          }
        />

        <PlanningContextMenu
          state={contextMenu}
          onClose={closeContextMenu}
          hasClipboard={!!clipboardTask}
          isMultiUser={contextMenu?.taskId ? (taskIndex.get(contextMenu.taskId)?.users?.length ?? 0) > 1 : false}
          isRecurring={ctxTask ? !!ctxTask.parentId : false}
          isLocked={ctxTask ? !!ctxTask.isLocked : false}
          canCreate={menuCanCreate}
          canEdit={menuCanEdit}
          canCopy={menuCanCopy}
          canCut={menuCanCut}
          canDelete={menuCanDelete}
          canPaste={menuCanPaste}
          canLock={menuCanLock}
          onEditTask={handleEditTask}
          onCopyTask={handleCopyTaskClip}
          onCutTask={handleCutTaskClip}
          onDeleteTask={handleDeleteTaskAction}
          onLockTask={handleLockTaskAction}
          onCreateTask={(rowId, dateStrArg) =>
            handleCreateAtCell(rowId, dateStrArg, contextMenu?.hour)
          }
          onPaste={(rowId, dateStrArg, hour) => handlePasteAtCell(rowId, dateStrArg, hour)}
        />

        <DeleteConfirmDialog
          open={!!multiDeleteState}
          onOpenChange={(open) => {
            if (!open) {
              setMultiDeleteState(null);
              setPendingRecurScope(null);
            }
          }}
          title={t("canvas.multiDelete.title")}
          description={t("canvas.multiDelete.description", {
            count: taskIndex.get(multiDeleteState?.taskId ?? "")?.users?.length ?? 0,
          })}
          onConfirm={() => {
            if (!multiDeleteState) return;
            const scope = pendingRecurScope?.scope as "single" | "all" | "after" | undefined;
            const id = multiDeleteState.taskId;
            if (editingTaskId === id) setEditingTaskId(null);
            setMultiDeleteState(null);
            setPendingRecurScope(null);
            startDeleteAnim(id);
            setTimeout(() => deleteTask.mutate({ id, scope }), 130);
          }}
          onArchive={() => {
            if (!multiDeleteState) return;
            removeUserMutation.mutate({
              taskId: multiDeleteState.taskId,
              userId: multiDeleteState.rowId,
              scope: pendingRecurScope?.scope as "single" | "all" | "after" | undefined,
            });
            setMultiDeleteState(null);
            setPendingRecurScope(null);
          }}
          confirmLabel={t("canvas.multiDelete.confirm")}
          archiveLabel={t("canvas.multiDelete.archive")}
        />

        <RecurringDeleteDialog
          open={!!recurDeleteState}
          onOpenChange={(open) => {
            if (!open) setRecurDeleteState(null);
          }}
          onDelete={(scope) => {
            if (!recurDeleteState) return;
            const task = taskIndex.get(recurDeleteState.taskId);
            const isMulti = (task?.users?.length ?? 0) > 1;
            const rowId = recurDeleteState.rowId;
            if (isMulti && rowId) {
              setPendingRecurScope({ taskId: recurDeleteState.taskId, scope });
              setMultiDeleteState({ taskId: recurDeleteState.taskId, rowId });
              setRecurDeleteState(null);
            } else {
              const id = recurDeleteState.taskId;
              if (editingTaskId === id) setEditingTaskId(null);
              setRecurDeleteState(null);
              startDeleteAnim(id);
              setTimeout(() => deleteTask.mutate({ id, scope: scope as "single" | "all" | "after" | undefined }), 130);
            }
          }}
        />

        {clipFeedback && (
          <div
            key={clipFeedback.key}
            style={{
              position: "fixed",
              left: clipFeedback.x + 14,
              top: clipFeedback.y - 8,
              zIndex: 100,
              pointerEvents: "none",
            }}
            className="flex items-center gap-1.5 rounded-md bg-foreground/90 px-2 py-1 text-[11px] font-medium text-background shadow-lg backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-150 [&>svg]:h-3 [&>svg]:w-3"
          >
            {clipFeedback.type === "copy" && (<><ClipboardCopy />{t("clipboard.copied")}</>)}
            {clipFeedback.type === "cut" && (<><Scissors />{t("clipboard.cut")}</>)}
            {clipFeedback.type === "paste" && (<><ClipboardPaste />{t("clipboard.pasted")}</>)}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ──────────────────────────────────────────────────────────────────
// Drawing helpers
// ──────────────────────────────────────────────────────────────────

interface DrawCtx extends BarDrawConfig {
  size: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  slots: TimeSlot[];
  slotWidth: number;
  allocatedRows: AllocatedRow[];
  totalContentHeight: number;
  dateStr: string;
  selectedDay: Date;
  showAvatar: boolean;
  dragState: DragState;
  getBarRect: (t: AllocatedTaskInRow, ar: AllocatedRow, sx: number, sy: number) => { x: number; y: number; width: number; height: number } | null;
  taskIndex: Map<string, TaskWithUsers>;
  taskAnimations: Map<string, TaskAnim>;
  hoveredTaskId: string | null;
  hoveredCell: { rowId: string; hour: number } | null;
  viewMode: ViewMode;
  /** Computed sidebar width (may differ from SIDEBAR_WIDTH_DEFAULT
   *  depending on the `PLANNING_SIDEBAR_WIDTH` config: auto / fixed / mobile cap). */
  sidebarWidth: number;
  /** ID of the task awaiting a DropActionMenu decision (Move/Copy).
   *  Its source bar is rendered at alpha 0.35 to signal that it is
   *  about to move / be copied. */
  pendingTaskId: string | null;
  /** Drop target position (transparent ghost painted while the menu
   *  awaits the Move/Copy decision). If null, no ghost. */
  pendingDrop: {
    taskId: string;
    targetRowId: string | null;
    sourceRowId: string;
    newStartTime: string;
    newEndTime: string;
  } | null;
  /** Skeleton bars painted during a tasks refetch (period change). */
  isFetching: boolean;
  /** Header language (day date, week, hour ranges). */
  i18n: HoursCanvasI18n;
}

/** Hours view language, precomputed on the React side (memoized). */
interface HoursCanvasI18n {
  /** date-fns locale: « Jeudi 30 octobre 2026 » / « Thursday 30 October 2026 ». */
  dateLocale: DateFnsLocale;
  /** App language: hour separator of `formatHourLabel` (8h / 08:00). */
  locale: AppLocale;
  /** TIME_FORMAT (24 h / 12 h) of the hour ranges. */
  timeFormat: TimeFormat;
  /** Week number prefix (« S19 » / « W19 »). */
  weekPrefix: string;
  /** Contract type labels (`users.contractTypes.*`), name suffix in the users view. */
  contractLabels: Record<ContractTypeKey, string>;
}

/** Measured widths of the hour labels (finite set: ≤ 25 hours ×
 *  a few fonts), to avoid calling `measureText` again on every redraw. */
const hourLabelWidthCache = new Map<string, number>();
function measureHourLabel(ctx: CanvasRenderingContext2D, text: string): number {
  const key = `${ctx.font}|${text}`;
  let width = hourLabelWidthCache.get(key);
  if (width === undefined) {
    width = ctx.measureText(text).width;
    hourLabelWidthCache.set(key, width);
  }
  return width;
}

function drawStatic(ctx: CanvasRenderingContext2D, p: DrawCtx) {
  const { size, scrollX, scrollY, slots, slotWidth, allocatedRows, totalContentHeight, selectedDay, showAvatar, dragState, sidebarWidth: SIDEBAR_W } = p;
  const w = size.width;
  const h = size.height;
  if (w === 0 || h === 0) return;
  ctx.imageSmoothingEnabled = false;
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const bgColor = isDark ? "rgb(10, 10, 10)" : "#ffffff";
  const mutedFg = isDark ? "rgb(140, 145, 155)" : "rgb(110, 115, 125)";
  const fgColor = isDark ? "rgb(245, 245, 250)" : "rgb(15, 23, 42)";
  const borderColor = isDark ? "rgb(72, 80, 92)" : "rgb(214, 218, 226)";

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const visibleX = scrollX;
  const visibleRight = scrollX + (w - SIDEBAR_W);
  const visibleY = scrollY;
  const visibleBot = scrollY + (h - HEADER_TOTAL_HEIGHT);
  const firstSlotIdx = Math.max(0, Math.floor(visibleX / slotWidth));
  const lastSlotIdx = Math.min(slots.length - 1, Math.ceil(visibleRight / slotWidth));
  // REAL right edge of the grid (in viewport pixels): we stop at the
  // last slot, not at the canvas edge. Keeps the horizontal borders
  // and the colored background of group headers from running on
  // into the empty space on the right when the grid is narrower than the
  // visible area (slots.length < (w - sidebar) / slotWidth).
  const totalSlotsPx = slots.length * slotWidth;
  const gridRightPx = Math.min(w, SIDEBAR_W + totalSlotsPx - scrollX);
  const gridSpan = Math.max(0, gridRightPx - SIDEBAR_W);

  // ── Pass 1: row header backgrounds ──
  for (const ar of allocatedRows) {
    if (ar.y + ar.height < visibleY) continue;
    if (ar.y > visibleBot) break;
    const yTop = HEADER_TOTAL_HEIGHT + ar.y - scrollY;
    if (ar.row.type === "header") {
      const groupColor = (ar.row as { color?: string | null }).color ?? "#22c55e";
      ctx.fillStyle = groupColor;
      ctx.fillRect(SIDEBAR_W, yTop, gridSpan, ar.height);
    }
  }

  // ── Pass 2: cell borders ──
  ctx.fillStyle = borderColor;
  for (const ar of allocatedRows) {
    if (ar.y + ar.height < visibleY) continue;
    if (ar.y > visibleBot) break;
    if (ar.row.type === "header") continue;
    const yTop = HEADER_TOTAL_HEIGHT + ar.y - scrollY;
    for (let i = firstSlotIdx; i <= lastSlotIdx + 1; i++) {
      const x = Math.round(SIDEBAR_W + i * slotWidth - scrollX);
      ctx.fillRect(x, yTop, 1, ar.height);
    }
    const yBot = Math.round(yTop + ar.height);
    ctx.fillRect(SIDEBAR_W, yBot, gridSpan, 1);
  }

  // ── Pass 2.5: cell hover overlay (before the bars, in the background) ──
  if (p.hoveredCell) {
    const ar = allocatedRows.find((r) => r.row.id === p.hoveredCell!.rowId);
    if (ar && ar.row.type !== "header") {
      const slotIdx = (() => {
        for (let i = 0; i < slots.length; i++) if (slots[i].hour === p.hoveredCell!.hour) return i;
        return -1;
      })();
      if (slotIdx >= 0) {
        const cellX = SIDEBAR_W + slotIdx * slotWidth - scrollX;
        const cellY = HEADER_TOTAL_HEIGHT + ar.y - scrollY;
        // Parity with the days canvas: color-mix(in oklch, --primary 10%, transparent).
        // Canvas 2D does not support oklch in every context → fallback to
        // direct RGB per theme (~10 % alpha on the primary color).
        ctx.fillStyle = isDark ? "rgba(220, 220, 230, 0.12)" : "rgba(45, 45, 50, 0.10)";
        ctx.fillRect(cellX, cellY, slotWidth, ar.height);
      }
    }
  }

  // ── Pass 2.6: skeleton bars during a tasks fetch ──
  // Keeps already loaded tasks (`keepPreviousData` cache) and animates
  // only the empty CELLS — per run of consecutive hour slots
  // without a task.
  if (p.isFetching) {
    const now = performance.now();
    let rowIdx = 0;
    for (const ar of allocatedRows) {
      if (ar.y + ar.height < visibleY) { rowIdx++; continue; }
      if (ar.y > visibleBot) break;
      if (ar.row.type === "header") { rowIdx++; continue; }
      const yTop = HEADER_TOTAL_HEIGHT + ar.y - scrollY;
      // Marks the hour slots occupied by at least one task.
      const occupied = new Set<number>();
      for (const t of ar.tasks) {
        const startH = Math.floor(t.startMin / 60);
        const endH = Math.ceil(t.endMin / 60);
        const sIdx = slots.findIndex((s) => s.hour === startH);
        const eIdxRaw = slots.findIndex((s) => s.hour === Math.max(startH, endH - 1));
        const sStart = Math.max(firstSlotIdx, sIdx >= 0 ? sIdx : 0);
        const sEnd = Math.min(lastSlotIdx, eIdxRaw >= 0 ? eIdxRaw : (sIdx >= 0 ? sIdx : 0));
        for (let s = sStart; s <= sEnd; s++) occupied.add(s);
      }
      let runStart = -1;
      for (let s = firstSlotIdx; s <= lastSlotIdx + 1; s++) {
        const isEmpty = s <= lastSlotIdx && !occupied.has(s);
        if (isEmpty && runStart < 0) {
          runStart = s;
        } else if (!isEmpty && runStart >= 0) {
          const runLen = s - runStart;
          if (runLen > 0) {
            const cellX = SIDEBAR_W + runStart * slotWidth - scrollX;
            const cellW = runLen * slotWidth;
            drawSkeletonCell(ctx, cellX, yTop, cellW, ar.height, now, isDark, rowIdx * 7 + runStart * 13);
          }
          runStart = -1;
        }
      }
      rowIdx++;
    }
  }

  // ── Pass 3: task bars ──
  const animsNow = performance.now();
  for (const ar of allocatedRows) {
    if (ar.y + ar.height < visibleY) continue;
    if (ar.y > visibleBot) break;
    if (ar.row.type === "header") continue;
    for (const t of ar.tasks) {
      const realTaskId = t.id.includes(":") && !t.id.startsWith("va:") && !t.id.startsWith("ra:")
        ? t.id.split(":")[0]
        : t.id;
      // Flexible match: drag.taskId / pendingTaskId may be the full
      // ID (compound `realId:userId` or pseudo `va:`/`ra:`) or the real
      // ID. We match on both to cover every case.
      const dragTaskId = dragState.taskId;
      const dragRealId = dragTaskId
        ? (dragTaskId.includes(":") && !dragTaskId.startsWith("va:") && !dragTaskId.startsWith("ra:")
            ? dragTaskId.split(":")[0]
            : dragTaskId)
        : null;
      const isDragSource =
        dragState.active &&
        dragTaskId !== null &&
        (t.id === dragTaskId || realTaskId === dragRealId);
      // During an active resize, skip the source bar — the preview
      // takes its place with the new width. Without the skip, the OLD bar
      // overlaps the preview and gives a "double" effect.
      if (isDragSource && dragState.mode !== "move") continue;

      const pendingTaskId = p.pendingTaskId;
      const pendingRealId = pendingTaskId
        ? (pendingTaskId.includes(":") && !pendingTaskId.startsWith("va:") && !pendingTaskId.startsWith("ra:")
            ? pendingTaskId.split(":")[0]
            : pendingTaskId)
        : null;
      const isPendingSource =
        pendingTaskId !== null &&
        (t.id === pendingTaskId || realTaskId === pendingRealId);

      const r = p.getBarRect(t, ar, scrollX, scrollY);
      if (!r) continue;
      const anim = p.taskAnimations.get(realTaskId) ?? p.taskAnimations.get(t.id);
      const effect = anim ? computeAnimEffect(anim, animsNow) : NEUTRAL_EFFECT;
      const ax = r.x + effect.offsetX;
      const ay = r.y + effect.offsetY;
      const aw = r.width + effect.offsetWidth;
      const isHovered =
        p.hoveredTaskId !== null &&
        (p.hoveredTaskId === t.id || p.hoveredTaskId === realTaskId);
      // Combines the animation alpha + the "drag/pending source" alpha (0.35)
      // — legacy parity: the source bar stays visible but
      // transparent to keep the original context.
      const sourceAlpha = isDragSource || isPendingSource ? 0.35 : 1;
      const finalAlpha = effect.alpha * sourceAlpha;
      ctx.save();
      ctx.globalAlpha *= finalAlpha;
      if (effect.scaleX !== 1) {
        const cx = ax + aw / 2;
        const cy = ay + p.barH / 2;
        ctx.translate(cx, cy);
        ctx.scale(effect.scaleX, effect.scaleX);
        ctx.translate(-cx, -cy);
      }
      drawTaskBar(ctx, t.task, ax, ay, aw, isHovered, p.viewMode, { barH: p.barH, fontFamily: p.fontFamily, cellFontSize: p.cellFontSize, fontBold: p.fontBold, canResizeTask: p.canResizeTask, untitled: p.untitled });
      ctx.restore();
    }
  }

  // ── Pass 3.5: transparent ghost at the drop target position ──
  // While the DropActionMenu awaits the decision (Move/Copy), we
  // show a ghost at the NEW position to signal where the task will
  // land. Skipped during an active drag (the drag preview already
  // occupies the screen at the current cursor position).
  if (p.pendingDrop && !dragState.active) {
    const realPendingId = p.pendingDrop.taskId.includes(":") && !p.pendingDrop.taskId.startsWith("va:") && !p.pendingDrop.taskId.startsWith("ra:")
      ? p.pendingDrop.taskId.split(":")[0]
      : p.pendingDrop.taskId;
    const pendingTask = p.taskIndex.get(realPendingId);
    const targetRowId = p.pendingDrop.targetRowId ?? p.pendingDrop.sourceRowId;
    const targetAr = allocatedRows.find((r) => r.row.id === targetRowId);
    if (pendingTask && targetAr) {
      const findIdx = (hour: number) => {
        for (let i = 0; i < slots.length; i++) if (slots[i].hour === hour) return i;
        for (let i = slots.length - 1; i >= 0; i--) if (slots[i].hour <= hour) return i;
        return -1;
      };
      const startH = parseInt(p.pendingDrop.newStartTime.split(":")[0], 10);
      const endH = parseInt(p.pendingDrop.newEndTime.split(":")[0], 10);
      const startIdx = findIdx(startH);
      const endIdx = findIdx(Math.max(startH, endH - 1));
      if (startIdx >= 0 && endIdx >= 0) {
        const ghostX = SIDEBAR_W + startIdx * slotWidth - scrollX + 2;
        const ghostWidth = Math.max((endIdx - startIdx + 1) * slotWidth - 4, 12);
        // Vertical slot: take the 1st free slot in the target row
        // (allocateTimeSlots will handle the final placement on the optimistic side).
        const ghostY = HEADER_TOTAL_HEIGHT + targetAr.y - scrollY + ROW_PADDING;
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawTaskBar(ctx, pendingTask, ghostX, ghostY, ghostWidth, false, p.viewMode, { barH: p.barH, fontFamily: p.fontFamily, cellFontSize: p.cellFontSize, fontBold: p.fontBold, canResizeTask: p.canResizeTask, untitled: p.untitled });
        ctx.restore();
      }
    }
  }

  // ── Sidebar ──
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, HEADER_TOTAL_HEIGHT, SIDEBAR_W, h - HEADER_TOTAL_HEIGHT);
  for (const ar of allocatedRows) {
    if (ar.y + ar.height < visibleY) continue;
    if (ar.y > visibleBot) break;
    const yTop = HEADER_TOTAL_HEIGHT + ar.y - scrollY;
    const yMid = yTop + ar.height / 2;
    if (ar.row.type === "header") {
      // Vibrantize for parity with the Days view (brighter colors,
      // visual consistency between inline and sticky banners).
      const groupColor = vibrantizeColor((ar.row as { color?: string | null }).color ?? "#22c55e");
      ctx.fillStyle = groupColor;
      ctx.fillRect(0, yTop, SIDEBAR_W, ar.height);
      const fgHeaderColor = getContrastColor(groupColor);
      // Optional icon by level (Building2 for BU, UsersRound for
      // team, Layers for project group) — same as the sidebar menu icons,
      // to spot the level faster.
      const iconName = headerIconFor(ar.row.id);
      let textX = 12;
      if (iconName) {
        const iconSize = 14;
        drawCanvasIcon(ctx, CANVAS_ICONS[iconName], textX, yMid - iconSize / 2, iconSize, fgHeaderColor);
        textX += iconSize + 6;
      }
      ctx.fillStyle = fgHeaderColor;
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const fitted = fitText(ctx, ar.row.name ?? "", SIDEBAR_W - textX - 12);
      ctx.fillText(fitted, textX, yMid);
      // Thin line at the bottom of the banner (Days view parity)
      ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
      ctx.fillRect(0, Math.round(yTop + ar.height) - 1, SIDEBAR_W, 1);
      continue;
    }
    const userColor = (ar.row as { color?: string | null }).color ?? "#6b7280";
    let textX = 12;
    if (showAvatar) {
      const avatarSize = 20;
      const avatarCx = 8 + avatarSize / 2;
      ctx.fillStyle = userColor;
      ctx.beginPath();
      ctx.arc(avatarCx, yMid, avatarSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = getContrastColor(userColor);
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(ar.row.name ?? ""), avatarCx, yMid + 0.5);
      textX = 8 + avatarSize + 8;
    }
    ctx.fillStyle = fgColor;
    ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // ContractType suffix in the users view (legacy `getContractSuffix` parity).
    let displayName = ar.row.name ?? "";
    if (p.viewMode === "users") {
      const suffix = getContractSuffix(
        (ar.row as { contractType?: string | null }).contractType,
        (key) => p.i18n.contractLabels[key],
      );
      if (suffix) displayName = `${displayName} [${suffix}]`;
    }
    const fitted = fitText(ctx, displayName, SIDEBAR_W - textX - 8);
    if (fitted) ctx.fillText(fitted, textX, yMid);
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, Math.round(yTop + ar.height), SIDEBAR_W, 1);
  }
  // Sidebar right border limited to the content
  const contentBottom = HEADER_TOTAL_HEIGHT + totalContentHeight - scrollY;
  const lineEnd = Math.min(h, Math.max(HEADER_TOTAL_HEIGHT, contentBottom));
  ctx.fillStyle = borderColor;
  ctx.fillRect(SIDEBAR_W, HEADER_TOTAL_HEIGHT, 1, Math.max(0, lineEnd - HEADER_TOTAL_HEIGHT));

  // ── Sticky group headers (BU + team / project) ──
  // Drawn BEFORE the Header block so the timeline (days + hours)
  // covers the sticky ones at the top during the transition — otherwise the
  // sticky banner overlaps the hours, as already avoided in the Days view.
  // 1:1 parity with the Days view (see renderer.ts).
  // Width passed = `gridRightPx` (end of the grid), not `w` (= total
  // canvas) — otherwise the banner overflows into the empty area on the right.
  drawStickyGroupHeaderHours(ctx, gridRightPx, SIDEBAR_W, scrollY, allocatedRows);

  // ── Header ──
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, HEADER_TOTAL_HEIGHT);
  const dateLabel = format(selectedDay, localizeDatePattern("EEEE d MMMM yyyy", p.i18n.dateLocale.code), { locale: p.i18n.dateLocale });
  const capitalized = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  const isTodayReal = isToday(selectedDay);
  const isWeekendReal = isWeekend(selectedDay);
  ctx.fillStyle = isTodayReal ? "rgb(234, 88, 12)" : isWeekendReal ? mutedFg : fgColor;
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(capitalized, SIDEBAR_W + 12, HEADER_DAY_HEIGHT / 2);

  for (let i = firstSlotIdx; i <= lastSlotIdx; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const x = SIDEBAR_W + i * slotWidth - scrollX;
    ctx.fillStyle = mutedFg;
    ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Range format « 8h — 9h » (legacy `hour-header.tsx:58` parity), based on
    // the language and TIME_FORMAT: « 08:00 — 09:00 », « 8AM — 9AM ». If the
    // range does not fit in the slot (minimum zoom, long labels),
    // only the start hour is shown.
    const nextHour = i < slots.length - 1 ? slots[i + 1].hour : slot.hour + 1;
    const startLabel = formatHourLabel(slot.hour, p.i18n.locale, p.i18n.timeFormat);
    const rangeLabel = `${startLabel} — ${formatHourLabel(nextHour, p.i18n.locale, p.i18n.timeFormat)}`;
    const hourText = measureHourLabel(ctx, rangeLabel) <= slotWidth - 6 ? rangeLabel : startLabel;
    ctx.fillText(hourText, x + slotWidth / 2, HEADER_DAY_HEIGHT + HEADER_HOUR_HEIGHT / 2);
  }

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, SIDEBAR_W, HEADER_TOTAL_HEIGHT);
  ctx.fillStyle = mutedFg;
  ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  // "S19" right-aligned (legacy `hour-header.tsx:34` parity) on
  // header line 1 — line 2 stays empty on the left.
  ctx.fillText(`${p.i18n.weekPrefix}${getISOWeek(selectedDay)}`, SIDEBAR_W - 8, HEADER_DAY_HEIGHT / 2);

  ctx.fillStyle = borderColor;
  // Borders drawn LAST so they go over the sidebar
  // re-bg — otherwise the `HEADER_DAY_HEIGHT` line was
  // erased over the sidebar area (above "S19").
  ctx.fillRect(0, HEADER_DAY_HEIGHT, gridRightPx, 1);
  ctx.fillRect(0, HEADER_TOTAL_HEIGHT, gridRightPx, 1);
  for (let i = firstSlotIdx; i <= lastSlotIdx + 1; i++) {
    const x = Math.round(SIDEBAR_W + i * slotWidth - scrollX);
    ctx.fillRect(x, HEADER_DAY_HEIGHT, 1, HEADER_HOUR_HEIGHT);
  }
  ctx.fillRect(Math.round(SIDEBAR_W), 0, 1, HEADER_TOTAL_HEIGHT);
}

/** Draws the sticky group banners (BU + team / project) for the
 *  hours view. 1:1 parity with `renderer.ts#drawStickyGroupHeader` (days view):
 *  - 2 possible levels (BU + child team) or 1 level (team, project group)
 *  - iOS-style push effect when a new banner arrives
 *  - offset threshold for level 2 = no "jump" on entry
 *  - parentBuId filtering: the last team of a BU does not reappear
 *    under a new BU
 *  - extra push via next1Y: the team leaves together with the BU
 *    when a new BU approaches from below
 *  - render order: team first, BU on top (the BU covers when
 *    the team is pushed up)
 */
function drawStickyGroupHeaderHours(
  ctx: CanvasRenderingContext2D,
  gridRightPx: number,
  sidebarW: number,
  scrollY: number,
  allocatedRows: AllocatedRow[],
): void {
  if (scrollY <= 0) return;

  const headerLevel = (id: string): 1 | 2 =>
    id.startsWith("header-bu-") && id.includes("-team-") ? 2 : 1;

  type Active = {
    row: { id: string; name?: string | null; color?: string | null };
    height: number;
    parentBuId: string | null;
  };
  let active1: Active | null = null;
  let next1Y: number | null = null;
  let active2: Active | null = null;
  let next2Y: number | null = null;
  let currentBuId: string | null = null;

  for (const ar of allocatedRows) {
    if (ar.row.type !== "header") continue;
    const level = headerLevel(ar.row.id);
    if (level === 1) currentBuId = ar.row.id;

    const a1: Active | null = active1;
    let threshold: number;
    if (level === 1) {
      threshold = scrollY;
    } else {
      threshold = scrollY + (a1 ? a1.height : 0);
    }
    if (ar.y <= threshold) {
      if (level === 1) {
        active1 = { row: ar.row, height: ar.height, parentBuId: null };
      } else {
        if (!active1 || currentBuId === active1.row.id) {
          active2 = { row: ar.row, height: ar.height, parentBuId: currentBuId };
        }
      }
    } else {
      if (level === 1 && next1Y === null) next1Y = ar.y;
      if (level === 2 && next2Y === null && a1 && currentBuId === a1.row.id) {
        next2Y = ar.y;
      }
      if (next1Y !== null && next2Y !== null) break;
    }
  }
  if (!active1 && !active2) return;
  if (
    active1 &&
    active2 &&
    active2.parentBuId !== null &&
    active2.parentBuId !== active1.row.id
  ) {
    active2 = null;
  }

  const computeY = (baseY: number, height: number, nextY: number | null): number => {
    if (nextY === null) return baseY;
    const nextOnScreen = HEADER_TOTAL_HEIGHT + nextY - scrollY;
    if (nextOnScreen < baseY + height) return nextOnScreen - height;
    return baseY;
  };

  const lvl1Y = active1 ? computeY(HEADER_TOTAL_HEIGHT, active1.height, next1Y) : 0;
  const lvl2BaseY = HEADER_TOTAL_HEIGHT + (active1 ? active1.height : 0);
  let lvl2Y = active2 ? computeY(lvl2BaseY, active2.height, next2Y) : 0;
  if (active2 && next1Y !== null) {
    const buNextOnScreen = HEADER_TOTAL_HEIGHT + next1Y - scrollY;
    if (buNextOnScreen < lvl2BaseY + active2.height) {
      const pushedByBu = buNextOnScreen - active2.height;
      if (pushedByBu < lvl2Y) lvl2Y = pushedByBu;
    }
  }

  if (active2) drawStickyBandHours(ctx, gridRightPx, sidebarW, active2.row, lvl2Y, active2.height);
  if (active1) drawStickyBandHours(ctx, gridRightPx, sidebarW, active1.row, lvl1Y, active1.height);
}

/** Renders a single sticky banner (parity with the native banners:
 *  full-width vibrantized color + truncated label on the sidebar side + icon
 *  by level + 30% black line at the bottom). */
function drawStickyBandHours(
  ctx: CanvasRenderingContext2D,
  gridRightPx: number,
  sidebarW: number,
  row: { id: string; name?: string | null; color?: string | null },
  y: number,
  height: number,
): void {
  const yTopR = Math.round(y);
  const heightR = Math.round(height);
  const yBotR = yTopR + heightR;
  const yMid = yTopR + heightR / 2;
  const color = vibrantizeColor(row.color ?? "#22c55e");
  ctx.fillStyle = color;
  // Width limited to `gridRightPx` (end of the hours grid), not to the
  // total canvas — otherwise the banner overflows into the empty area on the right.
  ctx.fillRect(0, yTopR, gridRightPx, heightR);
  const fgColor = getContrastColor(color);
  const iconName = headerIconFor(row.id);
  let textX = 12;
  if (iconName) {
    const iconSize = 14;
    drawCanvasIcon(ctx, CANVAS_ICONS[iconName], textX, yMid - iconSize / 2, iconSize, fgColor);
    textX += iconSize + 6;
  }
  ctx.fillStyle = fgColor;
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const fitted = fitText(ctx, row.name ?? "", sidebarW - textX - 12);
  ctx.fillText(fitted, textX, yMid);
  ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
  ctx.fillRect(0, yBotR - 1, gridRightPx, 1);
}

interface BarDrawConfig {
  barH: number;
  fontFamily: string;
  cellFontSize: number;
  fontBold: boolean;
  /** Returns true if the task can be resized by the current
   *  user (combines edit scope + the `tasks:resize` permission).
   *  Used to avoid drawing resize handles on tasks
   *  that cannot be resized (parity with the hit-test). */
  canResizeTask: (task: TaskWithUsers) => boolean;
  /** Fallback title for an untitled task (translated label). */
  untitled: string;
}

interface DragDrawCtx extends BarDrawConfig {
  drag: DragState;
  slots: TimeSlot[];
  slotWidth: number;
  allocatedRows: AllocatedRow[];
  scrollX: number;
  scrollY: number;
  getBarRect: (t: AllocatedTaskInRow, ar: AllocatedRow, sx: number, sy: number) => { x: number; y: number; width: number; height: number } | null;
  taskIndex: Map<string, TaskWithUsers>;
  viewMode: ViewMode;
  sidebarWidth: number;
}

function drawDragPreview(ctx: CanvasRenderingContext2D, p: DragDrawCtx) {
  const { drag, slots, slotWidth, allocatedRows, scrollX, scrollY, taskIndex, sidebarWidth: SIDEBAR_W, barH } = p;
  if (!drag.taskId) return;
  const realId = drag.taskId.includes(":") ? drag.taskId.split(":")[0] : drag.taskId;
  const task = taskIndex.get(realId);
  if (!task) return;
  // Rebuilds the source rect from the origins FROZEN at pointerdown.
  // Why: reading `allocatedRows` here would expose the preview to the optimistic
  // cache update (mutate.onMutate fires before the end of the 150 ms
  // post-release hold) → preview applies deltaHours to the NEW position
  // → +1 extra cell / flicker.
  const sourceAr = allocatedRows.find((ar) => ar.row.id === drag.sourceRowId);
  if (!sourceAr) return;
  const findIdx = (hour: number) => {
    for (let i = 0; i < slots.length; i++) if (slots[i].hour === hour) return i;
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].hour <= hour) return i;
    return -1;
  };
  const startH = Math.floor(drag.originStartMin / 60);
  const endH = Math.ceil(drag.originEndMin / 60);
  const startIdx = findIdx(startH);
  const endIdx = findIdx(endH - 1);
  if (startIdx < 0) return;
  const finalEndIdx = endIdx >= 0 ? endIdx : slots.length - 1;
  const baseX = SIDEBAR_W + startIdx * slotWidth - scrollX + 2;
  const baseWidth = Math.max((finalEndIdx - startIdx + 1) * slotWidth - 4, 12);
  const baseY = HEADER_TOTAL_HEIGHT + sourceAr.y - scrollY + drag.originSlot * (barH + TASK_BAR_GAP) + ROW_PADDING;

  const dx = drag.deltaHours * slotWidth;
  let x = baseX;
  let y = baseY;
  let width = baseWidth;
  if (drag.mode === "move") {
    x = baseX + dx;
    // Y target row
    if (drag.targetRowId && drag.targetRowId !== drag.sourceRowId) {
      const targetAr = allocatedRows.find((ar) => ar.row.id === drag.targetRowId);
      if (targetAr) {
        y = HEADER_TOTAL_HEIGHT + targetAr.y - scrollY + ROW_PADDING;
      }
    }
  } else if (drag.mode === "resize-left") {
    x = baseX + dx;
    width = Math.max(slotWidth - 4, baseWidth - dx);
  } else if (drag.mode === "resize-right") {
    width = Math.max(slotWidth - 4, baseWidth + dx);
  }

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.globalAlpha = 0.85;
  drawTaskBar(ctx, task, x, y, width, false, p.viewMode, { barH: p.barH, fontFamily: p.fontFamily, cellFontSize: p.cellFontSize, fontBold: p.fontBold, canResizeTask: p.canResizeTask, untitled: p.untitled });
  ctx.restore();
}

function drawTaskBar(ctx: CanvasRenderingContext2D, task: TaskWithUsers, x: number, y: number, width: number, isHovered: boolean, viewMode: ViewMode, cfg: BarDrawConfig) {
  const { barH, fontFamily, cellFontSize, fontBold } = cfg;
  // Saturation/lightness boost — parity with the days view.
  const bgColor = vibrantizeColor(task.project?.color ?? "#3b82f6");
  const baseColor = isHovered ? brightenColor(bgColor, 1.1) : bgColor;
  // Hours view: SOLID background (no morning/afternoon gradient) — the bar
  // is already positioned precisely on its time range, the half-day
  // gradient adds nothing and hurts readability.
  ctx.fillStyle = baseColor;
  roundedRect(ctx, x, y, width, barH, 2);
  ctx.fill();
  // Inset border (subtle) — parity with renderer.ts:968-970
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, width - 1, barH - 1, 2);
  ctx.stroke();

  // Label/icons: black or white based on W3C contrast with the solid background.
  const labelColor = getContrastColor(bgColor);
  const iconColor = labelColor;
  let cursorX = x + 6;
  const iconY = y + (barH - ICON_SIZE_DEFAULT) / 2;

  // Icons before the label. Clock removed in the hours view: the bar is
  // already positioned precisely on its time range, the icon would
  // duplicate the visual position information.
  if (task.parentId) {
    drawCanvasIcon(ctx, CANVAS_ICONS.parent, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
    cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, 4);
  }
  const fileCount = (task as unknown as { fileCount?: number }).fileCount ?? task.files?.length ?? 0;
  if (fileCount > 0) {
    drawCanvasIcon(ctx, CANVAS_ICONS.file, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
    cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, 4);
  }
  if ((task as unknown as { hasConflict?: boolean }).hasConflict) {
    drawCanvasIcon(ctx, CANVAS_ICONS.conflict, cursorX, y + (barH - ICON_SIZE_MEDIUM) / 2, ICON_SIZE_MEDIUM);
    cursorX += getIconLayoutWidth(ICON_SIZE_MEDIUM, 4);
  }
  if (task.isLocked) {
    drawCanvasIcon(ctx, CANVAS_ICONS.locked, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
    cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, 4);
  }

  // Label: getTaskLabel adapts to viewMode (users → project, projects → users, etc.).
  const label = getTaskLabel(task, viewMode, cfg.untitled);
  ctx.fillStyle = labelColor;
  // Font configurable by the admin (PLANNING_FONT_FAMILY / _CELL_FONTSIZE / _FONT_BOLD).
  ctx.font = `${fontBold ? "600" : "500"} ${cellFontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const fitted = fitText(ctx, label, x + width - cursorX - 6);
  if (fitted) ctx.fillText(fitted, cursorX, y + barH / 2 + 0.5);

  // Resize handles — visible on hover, unless the task is locked.
  // Visual parity with the days canvas: 6 px, rgba(0,0,0,0.35).
  // "all-day" tasks (no startTime): no resize in the hours view —
  // a full-day task cannot be resized on hour boundaries.
  // Resize stays available in the days view.
  // Non-resizable task (`tasks:resize` permission disabled or
  // insufficient scope): no handle either, so as not to suggest
  // an action the user cannot perform.
  const isAllDay = !task.startTime;
  const canResize = cfg.canResizeTask(task);
  if (isHovered && !task.isLocked && !isAllDay && canResize) {
    const handleW = 6;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    fillRoundedRectSide(ctx, x, y, handleW, barH, 2, "left");
    fillRoundedRectSide(ctx, x + width - handleW, y, handleW, barH, 2, "right");
  }
}

/** Rectangle rounded on 1 side only (left or right) — the other 2
 *  corners stay square. Used for the resize handles. */
function fillRoundedRectSide(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  side: "left" | "right"
) {
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
  ctx.fill();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth < 8 || !text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const w = ctx.measureText(text.slice(0, mid) + "…").width;
    if (w <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

function getContrastColor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#0f172a";
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#0f172a" : "#ffffff";
}

function brightenColor(hex: string, factor: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.min(255, Math.round(parseInt(c.substring(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(c.substring(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(c.substring(4, 6), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
