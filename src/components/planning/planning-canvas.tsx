"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { ClipboardCopy, ClipboardPaste, Scissors } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlanningStore } from "@/stores/planning-store";
import { usePlanningData } from "@/hooks/use-planning-data";
import { usePlanningConfig } from "@/hooks/use-planning-config";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { useCanvasPointer } from "@/hooks/use-canvas-pointer";
import { useCanvasTooltip } from "@/hooks/use-canvas-tooltip";
import { useCanvasA11y } from "@/hooks/use-canvas-a11y";
import { observeResize } from "@/lib/canvas/dpr";
import { extractRealTaskId } from "@/lib/canvas/renderer";
import { useDateFormat } from "@/hooks/use-date-format";
import { CANVAS_GEOMETRY } from "@/lib/canvas/theme";
import {
  INITIAL_DRAG_STATE,
  type CanvasDragState,
  type CanvasI18n,
  type CanvasRenderData,
  type CanvasViewport,
} from "@/lib/canvas/types";

import { GridToolbar } from "./grid-toolbar";
import { SummaryTable } from "./summary-table";
import { CONTRACT_TYPES, getContractSuffix } from "@/lib/constants/contract-types";
import { tDyn } from "@/i18n/dynamic";
// i18n-dynamic: users.contractTypes.*
import { TaskFormDialog } from "./task-form-dialog";
import { CanvasTooltipAnchor } from "./canvas-tooltip-anchor";
import { CanvasA11yMirror } from "./canvas-a11y-mirror";
import { TaskTooltip } from "./task-tooltip";
import { UserTooltip } from "./user-tooltip";
import { ProjectTooltip } from "./project-tooltip";
import { VehicleTooltip } from "./vehicle-tooltip";
import { DropActionMenu, PlanningContextMenu, type ContextMenuState } from "./context-menu";
import { useMoveTask, useCopyTask, useResizeTask, useDeleteTask, useUpdateTask, useRemoveUserFromTask } from "@/hooks/use-tasks";
import { useDeleteVehicleAssignment, useUpdateVehicleAssignment, useCreateVehicleAssignment } from "@/hooks/use-vehicle-assignments";
import { useDeleteResourceAssignment, useUpdateResourceAssignment, useCreateResourceAssignment } from "@/hooks/use-resource-assignments";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { RecurringDeleteDialog } from "./recurring-delete-dialog";
import { VehicleReserveDialog } from "@/components/vehicles/vehicle-reserve-dialog";
import { ResourceReserveDialog } from "@/components/resources/resource-reserve-dialog";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { gridScrollBounds, SCROLLBAR_SIZE, scrollThumbLength } from "@/lib/canvas/scroll-bounds";
import { useQueryClient } from "@tanstack/react-query";
import { socket, SOCKET_ENABLED } from "@/lib/socket-client";
import { useSocket } from "@/hooks/use-socket";
import { usePermissions } from "@/hooks/use-permissions";
import { useConfig } from "@/hooks/use-config";
import { parseDailyTaskLimit, wouldExceedDailyLimit } from "@/lib/utils/daily-task-limit";
import type { TaskWithUsers } from "@/types";
import type { GridRow } from "@/lib/utils/sort-rows";

/**
 * Main component of the planning grid, rendered as a hybrid Canvas.
 *
 * Still rendered in React DOM:
 *  - shadcn toolbar (filters, zoom, create)
 *  - shadcn modals (TaskFormDialog, etc.) — opened on canvas click
 *  - Rich Radix tooltip — anchored on a ghost div positioned by the canvas hover
 *  - Minimal a11y DOM mirror (role=grid, roving tabindex)
 *
 * The actual rendering of cells + task bars is fully
 * delegated to the `CanvasRenderer` engine (vanilla TS, no React).
 *
 * Perf-critical local state:
 *  - `dragStateRef`: mutated during a drag, read by the interactive rAF loop,
 *    no React notification → 60 fps guaranteed.
 *  - `hoveredTaskIdRef`: same for the visual hover (brightness on the bar).
 *  - `scrollX/scrollY`: local useState (re-render isolated to `<PlanningCanvas>`,
 *    triggers a static redraw via useEffect).
 *
 * This first version (Canvas step) supports:
 *  - Full grid display (cells, bars, sidebar, header)
 *  - Bar hover + Radix tooltip
 *  - Click on bar → opens the edit modal
 *  - Click on cell → opens the create modal
 *  - Horizontal/vertical scroll wheel
 *  - Minimal a11y (DOM mirror + roving tabindex)
 *
 * Drag-drop and resize: implemented in this component.
 */
export function PlanningCanvas() {
  const t = useTranslations("planning");
  const tUsers = useTranslations("users");
  const { dateLocale } = useDateFormat();
  // ──────────────────────────────────────────────────────────────────
  // 1. Global store — strict useShallow (re-render only when one
  //    of these values changes; never on dragOverCellId, pendingDrop,
  //    etc. — that is the Phase 1 lesson).
  // ──────────────────────────────────────────────────────────────────
  const {
    viewMode,
    startDate,
    endDate,
    cellWidth,
    showUserCount,
    showFileIcon,
    showRowAvatar,
    showSummary,
  } = usePlanningStore(
    useShallow((s) => ({
      viewMode: s.viewMode,
      startDate: s.startDate,
      endDate: s.endDate,
      cellWidth: s.cellWidth,
      showUserCount: s.showUserCount,
      showFileIcon: s.showFileIcon,
      showRowAvatar: s.showRowAvatar,
      showSummary: s.showSummary,
    }))
  );

  // ──────────────────────────────────────────────────────────────────
  // 2. Data — TanStack Query (Phase 1 rolling window kept)
  // ──────────────────────────────────────────────────────────────────
  const {
    tasks,
    sortedRows,
    holidays,
    statusMap,
    slotData,
    vehicleAssignmentMap,
    isLoading,
    isLoadingRows,
    isLoadingTasks,
    isFetching,
    error,
  } = usePlanningData();

  // ──────────────────────────────────────────────────────────────────
  // 3. Config / DOM refs
  // ──────────────────────────────────────────────────────────────────
  const { taskBarHeight, sidebarWidth: configSidebarWidth, sidebarWidthMobileMax, cellFontSize, fontFamily, fontBold } = usePlanningConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  // useState + ref callback: the only reliable pattern with React 19 +
  // StrictMode to react to DOM attachment.
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [staticCanvas, setStaticCanvas] = useState<HTMLCanvasElement | null>(null);
  const [interactiveCanvas, setInteractiveCanvas] = useState<HTMLCanvasElement | null>(null);
  const tooltipAnchorRef = useRef<HTMLDivElement>(null);

  // ──────────────────────────────────────────────────────────────────
  // 4. Local state — scroll, viewport, drag (never Zustand)
  // ──────────────────────────────────────────────────────────────────
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  // Mirror ref of the scrolls: lets us compute synchronously the delta
  // applied in `handleScroll` (impossible via the setScrollX callback,
  // which is async / batched) → essential to offset `drag.originX`
  // immediately and keep the drag preview bar stuck to the cursor.
  const scrollXRef = useRef(0);
  const scrollYRef = useRef(0);
  scrollXRef.current = scrollX;
  scrollYRef.current = scrollY;

  const dragStateRef = useRef<CanvasDragState>({ ...INITIAL_DRAG_STATE });
  const hoveredTaskIdRef = useRef<string | null>(null);
  const hoveredCellRef = useRef<{ rowId: string; dateStr: string } | null>(null);
  const isDragActiveRef = useRef(false);

  // ──────────────────────────────────────────────────────────────────
  // 5. UI state (dialogs opened from the canvas)
  // ──────────────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [prefillData, setPrefillData] = useState<{ rowId?: string; date?: string } | null>(null);

  // ──────────────────────────────────────────────────────────────────
  // 6. Viewport computation
  // ──────────────────────────────────────────────────────────────────
  const dayCount = useMemo(
    () => Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1,
    [startDate, endDate]
  );

  // Canvas language: labels computed ONCE here (never t() in
  // the render loop). Stable object as long as the language does not change →
  // the renderer only clears its header cache on language change.
  const canvasI18n = useMemo<CanvasI18n>(
    () => ({
      dateLocale,
      labels: {
        weekAbbr: t("canvas.weekAbbr"),
        weekPrefix: t("canvas.weekPrefix"),
        untitled: t("canvas.untitled"),
      },
      contractLabels: Object.fromEntries(CONTRACT_TYPES.map((c) => [c.key, tDyn(tUsers, `contractTypes.${c.key}`)])),
    }),
    [dateLocale, t, tUsers],
  );

  const computedSidebarWidth = useMemo(() => {
    if (configSidebarWidth !== "auto") return configSidebarWidth;
    if (typeof document === "undefined") return 200;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return 200;
    ctx.font = "500 14px ui-sans-serif, system-ui, sans-serif";
    let maxWidth = 0;
    for (const row of sortedRows) {
      if (row.type === "header") continue;
      // Users view: the "[Temporary worker]" suffix is part of the displayed name.
      const suffix = viewMode === "users"
        ? getContractSuffix((row as { contractType?: string | null }).contractType, (key) => canvasI18n.contractLabels[key] ?? "")
        : null;
      const w = ctx.measureText(suffix ? `${row.name ?? ""} [${suffix}]` : row.name ?? "").width;
      if (w > maxWidth) maxWidth = w;
    }
    const autoWidth = Math.max(160, Math.ceil(maxWidth + 48));
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    return isMobile ? Math.min(autoWidth, sidebarWidthMobileMax) : autoWidth;
  }, [configSidebarWidth, sortedRows, sidebarWidthMobileMax, viewMode, canvasI18n]);

  const viewport: CanvasViewport | null = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null;
    return {
      width: size.width,
      height: size.height,
      sidebarWidth: computedSidebarWidth,
      headerHeight: CANVAS_GEOMETRY.headerHeight,
      cellWidth,
      baseRowHeight: taskBarHeight + 8,
      dayCount,
      rowCount: sortedRows.length,
      scrollX,
      scrollY,
      gridStart: startDate,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    };
  }, [size, computedSidebarWidth, cellWidth, taskBarHeight, dayCount, sortedRows.length, scrollX, scrollY, startDate]);

  const renderData: CanvasRenderData | null = useMemo(() => {
    return {
      tasks,
      sortedRows,
      slotData,
      holidays,
      statusMap,
      showUserCount,
      showFileIcon,
      showRowAvatar,
      viewMode,
      fontFamily,
      cellFontSize,
      fontBold,
      taskBarHeight,
      isFetching,
      i18n: canvasI18n,
    };
  }, [tasks, sortedRows, slotData, holidays, statusMap, showUserCount, showFileIcon, showRowAvatar, viewMode, fontFamily, cellFontSize, fontBold, taskBarHeight, isFetching, canvasI18n]);

  // ──────────────────────────────────────────────────────────────────
  // 7. Container measurement via REF CALLBACK
  //
  // Diagnosis 2026-05-02: with a `useRef` + `useEffect`, the ref
  // was still `null` when the useEffect ran (React 19 StrictMode timing).
  // The ref callback is called explicitly by React on mount/unmount,
  // so we are sure to get the node at the right time.
  // ──────────────────────────────────────────────────────────────────
  const cleanupRef = useRef<(() => void) | null>(null);

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    // Clean up the previous observer if the node changes
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    containerRef.current = node;
    setContainerNode(node);

    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    // Triple measurement (sync, rAF, t+100ms) to handle cases where the flex
    // layout is not computed yet at mount (React 19 + StrictMode).
    measure();
    const raf1 = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 100);
    const ro = new ResizeObserver(measure);
    ro.observe(node);

    cleanupRef.current = () => {
      cancelAnimationFrame(raf1);
      clearTimeout(t1);
      ro.disconnect();
    };
  }, []);

  // Global cleanup on component unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // 8. Renderer + hooks
  // ──────────────────────────────────────────────────────────────────
  const {
    hitTest,
    requestStaticRedraw,
    getVisibleTaskIds,
    getTotalContentHeight,
    getTaskRect,
    getProspectiveTaskRect,
    startMoveAnimation,
    startResizeAnimation,
    startAppearAnimation,
    startDeleteAnimation,
    setPendingDropPreview,
  } = useCanvasRenderer({
    staticCanvas,
    interactiveCanvas,
    dragStateRef,
    hoveredTaskIdRef,
    hoveredCellRef,
    viewport,
    data: renderData,
  });

  // The "appear" animation is now triggered automatically by the renderer
  // in `setData` (see CanvasRenderer.setData) — sync detection of
  // new IDs before the next draw, so no "flash" at alpha=1.

  // ──────────────────────────────────────────────────────────────────
  // 8.bis Resync on theme toggle (light/dark)
  //
  // Why: the static canvas caches the pixels (cells, header, sidebar,
  // bar background halo). Colors are resolved on every
  // redraw via `getCssColor()` (shadcn OKLCH CSS vars), so forcing a
  // redraw when `resolvedTheme` changes is enough. Without it, the grid
  // keeps the previous theme's colors until an F5 or another
  // event that marks the static layer dirty.
  // ──────────────────────────────────────────────────────────────────
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    requestStaticRedraw();
  }, [resolvedTheme, requestStaticRedraw]);

  // Map taskId → task for the DOM mirror and the tooltip
  const taskIndex = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // ──────────────────────────────────────────────────────────────────
  // 8.quater Front-end permissions (parity with legacy scheduler-grid)
  //
  // Why: block placed here (after `taskIndex`, before the handlers) because
  // the section 9 handlers (`handleCellClick`, etc.) need
  // `canCreateAnyTask`/etc. at definition time, and the
  // *ById wrappers need `taskIndex`. CRITICAL ORDER — do not
  // move this section elsewhere without making sure no consumer
  // is defined earlier.
  // ──────────────────────────────────────────────────────────────────
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
  const { data: appConfig } = useConfig();
  const dailyLimit = useMemo(
    () => parseDailyTaskLimit(appConfig?.PLANNING_MAX_TASKS_PER_DAY),
    [appConfig?.PLANNING_MAX_TASKS_PER_DAY]
  );

  // Touch device detection (mobile/tablet) to disable drag,
  // resize and tooltips. The user only has click to create/open.
  // Declared here because `canDragTaskFn` / `canResizeTaskFn` need it.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouchDevice(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** A task is draggable if: not locked, and
   *  the user has `canMoveTask` (modifyScope) or `canCreateAnyTask` (to
   *  drag-and-drop a copy). Parity with legacy `task-bar-draggable.tsx:55`.
   *  On mobile: drag fully disabled (the user only has click to
   *  open/create; a finger swipe scrolls the grid). */
  const canDragTaskFn = useCallback(
    (task: TaskWithUsers) =>
      !isTouchDevice &&
      task.isLocked !== true &&
      (canMoveTask(task) || canCreateAnyTask),
    [isTouchDevice, canMoveTask, canCreateAnyTask]
  );
  /** Resize: not locked + canResizeTask. Disabled on mobile. */
  const canResizeTaskFn = useCallback(
    (task: TaskWithUsers) =>
      !isTouchDevice && task.isLocked !== true && canResizeTask(task),
    [isTouchDevice, canResizeTask]
  );

  /** Wrapper of `canDragTaskFn` that accepts a users-view compound id
   *  (`${realId}:${userId}`). Returns `false` if the task is not found. */
  const canDragTaskById = useCallback(
    (taskId: string): boolean => {
      const realId = extractRealTaskId(taskId);
      const t = taskIndex.get(realId);
      return t ? canDragTaskFn(t) : false;
    },
    [taskIndex, canDragTaskFn]
  );
  const canResizeTaskById = useCallback(
    (taskId: string): boolean => {
      const realId = extractRealTaskId(taskId);
      const t = taskIndex.get(realId);
      return t ? canResizeTaskFn(t) : false;
    },
    [taskIndex, canResizeTaskFn]
  );

  // ──────────────────────────────────────────────────────────────────
  // 9. Pointer events
  // ──────────────────────────────────────────────────────────────────
  const handleTaskClick = useCallback((taskId: string) => {
    // Vehicle pseudo-tasks (`va:${assignmentId}`) → VehicleReserveDialog
    if (taskId.startsWith("va:")) {
      setEditingAssignmentId(taskId.slice(3));
      setVehicleReservePrefill(null);
      setVehicleReserveOpen(true);
      return;
    }
    // Resource pseudo-tasks (`ra:${assignmentId}`) → ResourceReserveDialog
    if (taskId.startsWith("ra:")) {
      setEditingResourceAssignmentId(taskId.slice(3));
      setResourceReservePrefill(null);
      setResourceReserveOpen(true);
      return;
    }
    // In the users view, the ID is compound `${taskId}:${userId}` —
    // the API and the dialog only expect the real task UUID.
    const realTaskId = extractRealTaskId(taskId);
    setEditingTaskId(realTaskId);
    setPrefillData(null);
    setDialogOpen(true);
  }, []);

  const handleCellClick = useCallback(
    (rowId: string, dateStr: string) => {
      // Parity with legacy scheduler-grid.tsx:366-400: silent return if
      // permission is insufficient (scope, daily limit).
      // Vehicles view → VehicleReserveDialog (vehicle reservation creation)
      if (viewMode === "vehicles") {
        if (!can("vehicles:create")) return;
        setEditingAssignmentId(null);
        setVehicleReservePrefill({ vehicleId: rowId, date: dateStr });
        setVehicleReserveOpen(true);
        return;
      }
      // Resources view → ResourceReserveDialog
      if (viewMode === "resources") {
        if (!can("resources:create")) return;
        setEditingResourceAssignmentId(null);
        setResourceReservePrefill({ resourceId: rowId, date: dateStr });
        setResourceReserveOpen(true);
        return;
      }
      if (!canCreateAnyTask) return;
      const row = sortedRows.find((r) => r.id === rowId);
      if (
        row &&
        row.type === "row" &&
        !canCreateOnPlanningRow(viewMode, row as GridRow)
      ) {
        return;
      }
      // Daily limit (users view only, rowId = userId)
      if (viewMode === "users" && dailyLimit > 0) {
        if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [rowId], startDate: dateStr })) {
          return;
        }
      }
      setEditingTaskId(null);
      setPrefillData({ rowId, date: dateStr });
      setDialogOpen(true);
    },
    [can, canCreateAnyTask, canCreateOnPlanningRow, viewMode, sortedRows, dailyLimit, tasks]
  );

  const handleScroll = useCallback(
    (deltaX: number, deltaY: number) => {
      const { maxX, maxY } = gridScrollBounds(
        dayCount * cellWidth,
        getTotalContentHeight(),
        size.width - computedSidebarWidth,
        size.height - CANVAS_GEOMETRY.headerHeight,
        !isTouchDevice,
      );
      // Synchronous computation of the applied delta via the mirror refs:
      // setScrollX is async/batched, we cannot rely on it
      // to adjust `drag.originX` in the same frame.
      const prevX = scrollXRef.current;
      const prevY = scrollYRef.current;
      const nextX = Math.max(0, Math.min(maxX, prevX + deltaX));
      const nextY = Math.max(0, Math.min(maxY, prevY + deltaY));
      const appliedDx = nextX - prevX;
      const appliedDy = nextY - prevY;
      scrollXRef.current = nextX;
      scrollYRef.current = nextY;
      setScrollX(nextX);
      setScrollY(nextY);
      // If a drag is active, offset the scroll by shifting the drag
      // origin — so `pointerDx/Dy` stays consistent and the bar follows the
      // mouse during a wheel scroll / edge auto-scroll.
      const drag = dragStateRef.current;
      if (drag.active) {
        drag.originX -= appliedDx;
        drag.originY -= appliedDy;
      }
    },
    [getTotalContentHeight, dayCount, cellWidth, size.width, size.height, computedSidebarWidth, isTouchDevice]
  );

  // ──────────────────────────────────────────────────────────────────
  // 9.bis API mutations (drag/drop, resize, copy, delete, update)
  // ──────────────────────────────────────────────────────────────────
  const moveTask = useMoveTask();
  const copyTask = useCopyTask();
  const resizeTask = useResizeTask();
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const removeUserMutation = useRemoveUserFromTask();
  const deleteVehicleAssignment = useDeleteVehicleAssignment();
  const updateVehicleAssignment = useUpdateVehicleAssignment();
  const createVehicleAssignment = useCreateVehicleAssignment();
  const deleteResourceAssignment = useDeleteResourceAssignment();
  const updateResourceAssignment = useUpdateResourceAssignment();
  const createResourceAssignment = useCreateResourceAssignment();
  // State for the delete dialogs (multi-user / recurrence).
  const [multiDeleteState, setMultiDeleteState] = useState<{ taskId: string; rowId: string } | null>(null);
  const [recurDeleteState, setRecurDeleteState] = useState<{ taskId: string; rowId?: string } | null>(null);
  const [pendingRecurScope, setPendingRecurScope] = useState<{ taskId: string; scope: "single" | "all" | "before" | "after" } | null>(null);
  // State for the vehicles/resources dialogs
  const [vehicleReserveOpen, setVehicleReserveOpen] = useState(false);
  const [vehicleReservePrefill, setVehicleReservePrefill] = useState<{ vehicleId?: string; date?: string } | null>(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [resourceReserveOpen, setResourceReserveOpen] = useState(false);
  const [resourceReservePrefill, setResourceReservePrefill] = useState<{ resourceId?: string; date?: string } | null>(null);
  const [editingResourceAssignmentId, setEditingResourceAssignmentId] = useState<string | null>(null);

  // (Permissions block moved to section 8.quater, right after taskIndex,
  //  so that all section 9 handlers can refer to it.)
  const { clipboardTask, setClipboard, clearClipboard } = usePlanningStore(
    useShallow((s) => ({
      clipboardTask: s.clipboardTask,
      setClipboard: s.setClipboard,
      clearClipboard: s.clearClipboard,
    }))
  );

  /** Builds the viewMode-specific payload for move/copy.
   *  E.g. users view → userIds, projects view → projectId. */
  const getRowFieldData = useCallback(
    (targetRowId: string | null): Record<string, unknown> => {
      if (!targetRowId) return {};
      switch (viewMode) {
        case "users":
          return { userIds: [targetRowId] };
        case "projects":
          return { projectId: targetRowId };
        case "places":
          return { placeId: targetRowId };
        case "resources":
          return { resourceId: targetRowId };
        default:
          return {};
      }
    },
    [viewMode]
  );

  /** Info about the last drop (used by DropActionMenu to offer
   *  the Move / MoveUser / Copy choice). Reset after a choice or Cancel. */
  const [dropInfo, setDropInfo] = useState<{
    taskId: string;
    sourceRowId: string;
    targetRowId: string | null;
    newStartDate: string;
    newEndDate: string;
    deltaDays: number;
    dropPosition: { x: number; y: number };
  } | null>(null);

  const handleDragComplete = useCallback(
    (info: {
      taskId: string;
      sourceRowId: string;
      targetRowId: string;
      deltaDays: number;
      clickedDayIdx: number;
      dropX: number;
      dropY: number;
    }) => {
      isDragActiveRef.current = false;
      // Users view: taskId is compound `${realTaskId}:${userId}`. We
      // get the real task UUID for the API mutations.
      const realTaskId = extractRealTaskId(info.taskId);
      const task = taskIndex.get(realTaskId);
      if (!task) return;

      // Drop on the same row + no movement = no-op
      const sameRow = info.sourceRowId === info.targetRowId;
      if (sameRow && info.deltaDays === 0) return;

      // Compute the new dates by applying the delta
      const oldStart = parseISO(task.startDate);
      const oldEnd = task.endDate ? parseISO(task.endDate) : oldStart;
      const newStart = addDays(oldStart, info.deltaDays);
      const newEnd = addDays(oldEnd, info.deltaDays);

      const newStartStr = format(newStart, "yyyy-MM-dd");
      const newEndStr = format(newEnd, "yyyy-MM-dd");
      setDropInfo({
        taskId: realTaskId,
        sourceRowId: info.sourceRowId,
        targetRowId: info.targetRowId,
        newStartDate: newStartStr,
        newEndDate: newEndStr,
        deltaDays: info.deltaDays,
        dropPosition: { x: info.dropX, y: info.dropY },
      });
      // Shows a semi-transparent ghost at the target position while
      // the Move/Copy menu is open (legacy parity).
      setPendingDropPreview({
        taskId: realTaskId,
        targetRowId: info.targetRowId,
        newStartDate: newStartStr,
        newEndDate: newEndStr,
      });
    },
    [taskIndex, setPendingDropPreview]
  );

  const clearDrop = useCallback(() => {
    setDropInfo(null);
    setPendingDropPreview(null);
  }, [setPendingDropPreview]);

  const handleDropMove = useCallback(() => {
    if (!dropInfo) return;
    const taskId = dropInfo.taskId;
    // Snapshot of the from/to positions: fromRect = cached position (OLD)
    // since the mutate has not propagated yet. toRect = computed directly
    // from (targetRowId, newDates) — no need to wait for the cache.
    const fromRect = getTaskRect(taskId);
    const toRect = dropInfo.targetRowId
      ? getProspectiveTaskRect(
          dropInfo.targetRowId,
          taskId,
          dropInfo.newStartDate,
          dropInfo.newEndDate
        )
      : null;
    // Start the anim BEFORE the mutate, and clear dragState right away:
    // otherwise the next rAF tick draws the bar at the NEW position without anim
    // (because the renderer's rAF fires before the requestAnimationFrame).
    if (fromRect && toRect) {
      dragStateRef.current = { ...INITIAL_DRAG_STATE };
      startMoveAnimation(taskId, fromRect.x, fromRect.y, toRect.x, toRect.y);
    }
    // Vehicle pseudo-task: update assignment (vehicleId if cross-row)
    if (taskId.startsWith("va:")) {
      updateVehicleAssignment.mutate({
        id: taskId.slice(3),
        data: {
          startDate: dropInfo.newStartDate,
          endDate: dropInfo.newEndDate,
          ...(dropInfo.targetRowId ? { vehicleId: dropInfo.targetRowId } : {}),
        },
      });
      clearDrop();
      return;
    }
    if (taskId.startsWith("ra:")) {
      updateResourceAssignment.mutate({
        id: taskId.slice(3),
        data: {
          startDate: dropInfo.newStartDate,
          endDate: dropInfo.newEndDate,
          ...(dropInfo.targetRowId ? { resourceId: dropInfo.targetRowId } : {}),
        },
      });
      clearDrop();
      return;
    }
    // Users view + multi-user:
    // - "Move (all)" shifts the dates AND adds the target user to the
    //   assignee list (without removing the source or the others): the
    //   cross-user case on another day.
    // - Without cross-user (drop on the source row), only the dates change
    //   for everyone (parity with legacy scheduler-grid:736).
    const sourceTask = taskIndex.get(taskId);
    const isMultiUser = (sourceTask?.users?.length ?? 0) > 1;
    let dropFields: Record<string, unknown>;
    if (isMultiUser && viewMode === "users") {
      const isCrossUser =
        !!dropInfo.targetRowId && dropInfo.targetRowId !== dropInfo.sourceRowId;
      if (isCrossUser) {
        const currentUserIds = sourceTask?.users?.map((u) => u.id) ?? [];
        const merged = Array.from(new Set([...currentUserIds, dropInfo.targetRowId!]));
        dropFields = { userIds: merged };
      } else {
        dropFields = {};
      }
    } else {
      dropFields = getRowFieldData(dropInfo.targetRowId);
    }
    moveTask.mutate({
      id: taskId,
      data: {
        startDate: dropInfo.newStartDate,
        endDate: dropInfo.newEndDate,
        ...dropFields,
      },
    });
    clearDrop();
  }, [dropInfo, moveTask, getRowFieldData, clearDrop, getTaskRect, getProspectiveTaskRect, startMoveAnimation, taskIndex, viewMode, updateVehicleAssignment, updateResourceAssignment]);

  /** "Add this user": adds the target user to the task's
   *  assignee list, without changing the dates. Only shown
   *  in case A (multi-user drop → other user, SAME day). */
  const handleDropAddUser = useCallback(() => {
    if (!dropInfo || !dropInfo.targetRowId) return;
    const sourceTask = taskIndex.get(dropInfo.taskId);
    const currentUserIds = sourceTask?.users?.map((u) => u.id) ?? [];
    const merged = Array.from(new Set([...currentUserIds, dropInfo.targetRowId]));
    updateTask.mutate({
      id: dropInfo.taskId,
      data: { userIds: merged },
    });
    clearDrop();
  }, [dropInfo, taskIndex, updateTask, clearDrop]);

  /** "Move (this user)" in the multi-user users view: removes the
   *  source user from the original task and creates a copy for them at the
   *  new dates. Parity with legacy `scheduler-grid.tsx:788-805`. */
  const handleDropMoveUser = useCallback(() => {
    if (!dropInfo || !dropInfo.sourceRowId) return;
    const sourceUserId = dropInfo.sourceRowId;
    removeUserMutation.mutate({
      taskId: dropInfo.taskId,
      userId: sourceUserId,
    });
    copyTask.mutate({
      id: dropInfo.taskId,
      data: {
        startDate: dropInfo.newStartDate,
        userIds: [sourceUserId],
      },
    });
    clearDrop();
  }, [dropInfo, removeUserMutation, copyTask, clearDrop]);

  const handleDropCopy = useCallback(() => {
    if (!dropInfo) return;
    const taskId = dropInfo.taskId;
    // Vehicle pseudo-task → create new assignment via /api/vehicle-assignments
    if (taskId.startsWith("va:")) {
      const source = taskIndex.get(taskId);
      if (source) {
        createVehicleAssignment.mutate({
          vehicleId: dropInfo.targetRowId || (source as unknown as { vehicleId?: string }).vehicleId || "",
          startDate: dropInfo.newStartDate,
          endDate: dropInfo.newEndDate || dropInfo.newStartDate,
          startTime: source.startTime || null,
          endTime: source.endTime || null,
          projectId: source.projectId || null,
          notes: source.notes || null,
          type: (source as unknown as { vehicleAssignmentType?: string }).vehicleAssignmentType || "reservation",
        });
      }
      clearDrop();
      return;
    }
    if (taskId.startsWith("ra:")) {
      const source = taskIndex.get(taskId);
      if (source) {
        createResourceAssignment.mutate({
          resourceId: dropInfo.targetRowId || (source as unknown as { resourceAssignmentId?: string }).resourceAssignmentId || "",
          startDate: dropInfo.newStartDate,
          endDate: dropInfo.newEndDate || dropInfo.newStartDate,
          startTime: source.startTime || null,
          endTime: source.endTime || null,
          projectId: source.projectId || null,
          notes: source.notes || null,
          type: (source as unknown as { resourceAssignmentType?: string }).resourceAssignmentType || "reservation",
        });
      }
      clearDrop();
      return;
    }
    copyTask.mutate({
      id: taskId,
      data: {
        startDate: dropInfo.newStartDate,
        ...getRowFieldData(dropInfo.targetRowId),
      },
    });
    clearDrop();
  }, [dropInfo, copyTask, getRowFieldData, clearDrop, taskIndex, createVehicleAssignment, createResourceAssignment]);

  // ──────────────────────────────────────────────────────────────────
  // 9.ter Context menu (right-click on bar or cell)
  // ──────────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleTaskContextMenu = useCallback(
    (taskId: string, _rowId: string, x: number, y: number) => {
      const realTaskId = extractRealTaskId(taskId);
      setContextMenu({ x, y, taskId: realTaskId, rowId: _rowId });
    },
    []
  );

  const handleCellContextMenu = useCallback(
    (rowId: string, dateStr: string, x: number, y: number) => {
      setContextMenu({ x, y, rowId, dateStr });
    },
    []
  );

  const handleEditTask = useCallback((taskId: string) => {
    if (taskId.startsWith("va:")) {
      setEditingAssignmentId(taskId.slice(3));
      setVehicleReservePrefill(null);
      setVehicleReserveOpen(true);
      return;
    }
    if (taskId.startsWith("ra:")) {
      setEditingResourceAssignmentId(taskId.slice(3));
      setResourceReservePrefill(null);
      setResourceReserveOpen(true);
      return;
    }
    setEditingTaskId(taskId);
    setPrefillData(null);
    setDialogOpen(true);
  }, []);

  // Small visual feedback near the cursor after Ctrl+C / Ctrl+X / Ctrl+V.
  const [clipFeedback, setClipFeedback] = useState<{
    type: "copy" | "cut" | "paste";
    x: number;
    y: number;
    key: number;
  } | null>(null);
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

  const handleCopyTaskClip = useCallback(
    (taskId: string) => {
      // Legacy parity: copy = create a new task → canCreateAnyTask
      if (!canCreateAnyTask) return;
      setClipboard(taskId, "copy");
      showClipFeedback("copy");
    },
    [setClipboard, showClipFeedback, canCreateAnyTask]
  );

  const handleCutTaskClip = useCallback(
    (taskId: string) => {
      // Legacy parity: cut = move → canMoveTask + not locked
      const realId = extractRealTaskId(taskId);
      const task = taskIndex.get(realId);
      if (!task || task.isLocked || !canMoveTask(task)) return;
      setClipboard(taskId, "cut");
      showClipFeedback("cut");
    },
    [setClipboard, showClipFeedback, taskIndex, canMoveTask]
  );

  const handleDeleteTaskAction = useCallback(
    (taskId: string, rowId?: string) => {
      // Legacy parity: canDeleteTask + not locked
      // Vehicle/resource pseudo-tasks → dedicated API, no scope/multi-user
      if (taskId.startsWith("va:")) {
        if (!can("vehicles:delete")) return;
        const vaId = taskId.slice(3);
        startDeleteAnimation(taskId);
        setTimeout(() => deleteVehicleAssignment.mutate(vaId), 130);
        return;
      }
      if (taskId.startsWith("ra:")) {
        if (!can("resources:delete")) return;
        const raId = taskId.slice(3);
        startDeleteAnimation(taskId);
        setTimeout(() => deleteResourceAssignment.mutate(raId), 130);
        return;
      }
      const realId = extractRealTaskId(taskId);
      const task = taskIndex.get(realId);
      if (!task || task.isLocked || !canDeleteTask(task)) return;
      // Routing: recurring → RecurringDeleteDialog (scope);
      // multi-user → DeleteConfirmDialog (delete user vs delete all).
      // Otherwise: direct deletion with anim.
      if (task.parentId) {
        setRecurDeleteState({ taskId: realId, rowId });
        return;
      }
      if ((task.users?.length ?? 0) > 1 && rowId) {
        setMultiDeleteState({ taskId: realId, rowId });
        return;
      }
      // Simple deletion: anim + delayed mutation. The mutate fires at
      // 130 ms (before the end of the 160 ms anim) → the task is removed
      // from the cache while the alpha effect is still close to 0,
      // avoiding a "full opacity" frame between the end of the anim and
      // the removal from the cache (perceived flicker).
      if (editingTaskId === realId) setEditingTaskId(null);
      startDeleteAnimation(realId);
      setTimeout(() => {
        deleteTask.mutate({ id: realId });
      }, 130);
    },
    [deleteTask, startDeleteAnimation, taskIndex, canDeleteTask, editingTaskId, can, deleteVehicleAssignment, deleteResourceAssignment]
  );

  const handleLockTaskAction = useCallback(
    (taskId: string) => {
      // Legacy parity: canLockTask
      const t = taskIndex.get(taskId);
      if (!t) return;
      const newLocked = !t.isLocked;
      if (taskId.startsWith("va:")) {
        updateVehicleAssignment.mutate({ id: taskId.slice(3), data: { isLocked: newLocked } });
        return;
      }
      if (taskId.startsWith("ra:")) {
        updateResourceAssignment.mutate({ id: taskId.slice(3), data: { isLocked: newLocked } });
        return;
      }
      if (!canLockTask(t)) return;
      updateTask.mutate({ id: taskId, data: { isLocked: newLocked } });
    },
    [updateTask, taskIndex, canLockTask, updateVehicleAssignment, updateResourceAssignment]
  );

  const handleCreateAtCell = useCallback(
    (rowId: string, dateStr: string) => {
      // Legacy parity: reuses the same gate as handleCellClick
      if (!canCreateAnyTask) return;
      const row = sortedRows.find((r) => r.id === rowId);
      if (
        row &&
        row.type === "row" &&
        !canCreateOnPlanningRow(viewMode, row as GridRow)
      ) {
        return;
      }
      if (viewMode === "users" && dailyLimit > 0) {
        if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [rowId], startDate: dateStr })) {
          return;
        }
      }
      setEditingTaskId(null);
      setPrefillData({ rowId, date: dateStr });
      setDialogOpen(true);
    },
    [canCreateAnyTask, sortedRows, canCreateOnPlanningRow, viewMode, dailyLimit, tasks]
  );

  const handlePasteAtCell = useCallback(
    (rowId: string, dateStr: string) => {
      if (!clipboardTask) return;
      const source = taskIndex.get(clipboardTask.taskId);
      if (!source) {
        clearClipboard();
        return;
      }
      const sourceId = clipboardTask.taskId;
      // Legacy parity scheduler-grid:647-664
      if (clipboardTask.mode === "copy") {
        if (!canCreateAnyTask) return;
      } else {
        if (source.isLocked || !canMoveTask(source)) return;
      }
      const destRow = sortedRows.find((r) => r.id === rowId);
      if (
        destRow &&
        destRow.type === "row" &&
        !canCreateOnPlanningRow(viewMode, destRow as GridRow)
      ) {
        return;
      }
      // Daily limit (users view only)
      if (viewMode === "users" && dailyLimit > 0) {
        if (wouldExceedDailyLimit(tasks, dailyLimit, { userIds: [rowId], startDate: dateStr })) {
          return;
        }
      }
      // Keep the duration of the source task
      const oldStart = parseISO(source.startDate);
      const oldEnd = source.endDate ? parseISO(source.endDate) : oldStart;
      const span = differenceInCalendarDays(oldEnd, oldStart);
      const newStart = dateStr;
      const newEnd = format(addDays(parseISO(dateStr), span), "yyyy-MM-dd");
      // Vehicle/resource pseudo-tasks → dedicated API
      if (sourceId.startsWith("va:")) {
        const vaId = sourceId.slice(3);
        if (clipboardTask.mode === "copy") {
          createVehicleAssignment.mutate({
            vehicleId: rowId,
            startDate: newStart,
            endDate: newEnd,
            startTime: source.startTime || null,
            endTime: source.endTime || null,
            projectId: source.projectId || null,
            notes: source.notes || null,
            type: (source as unknown as { vehicleAssignmentType?: string }).vehicleAssignmentType || "reservation",
          });
        } else {
          updateVehicleAssignment.mutate({ id: vaId, data: { vehicleId: rowId, startDate: newStart, endDate: newEnd } });
          clearClipboard();
        }
        showClipFeedback("paste");
        return;
      }
      if (sourceId.startsWith("ra:")) {
        const raId = sourceId.slice(3);
        if (clipboardTask.mode === "copy") {
          createResourceAssignment.mutate({
            resourceId: rowId,
            startDate: newStart,
            endDate: newEnd,
            startTime: source.startTime || null,
            endTime: source.endTime || null,
            projectId: source.projectId || null,
            notes: source.notes || null,
            type: (source as unknown as { resourceAssignmentType?: string }).resourceAssignmentType || "reservation",
          });
        } else {
          updateResourceAssignment.mutate({ id: raId, data: { resourceId: rowId, startDate: newStart, endDate: newEnd } });
          clearClipboard();
        }
        showClipFeedback("paste");
        return;
      }
      const rowFields = getRowFieldData(rowId);
      if (clipboardTask.mode === "copy") {
        copyTask.mutate({
          id: sourceId,
          data: { startDate: newStart, ...rowFields },
        });
      } else {
        moveTask.mutate({
          id: sourceId,
          data: { startDate: newStart, endDate: newEnd, ...rowFields },
        });
        clearClipboard(); // cut consumes the clipboard
      }
      showClipFeedback("paste");
    },
    [
      clipboardTask,
      taskIndex,
      copyTask,
      moveTask,
      getRowFieldData,
      clearClipboard,
      showClipFeedback,
      canCreateAnyTask,
      canMoveTask,
      sortedRows,
      canCreateOnPlanningRow,
      viewMode,
      dailyLimit,
      tasks,
      createVehicleAssignment,
      updateVehicleAssignment,
      createResourceAssignment,
      updateResourceAssignment,
    ]
  );

  const handleResizeComplete = useCallback(
    (info: { taskId: string; edge: "left" | "right"; deltaDays: number }) => {
      if (info.deltaDays === 0) return;
      const realTaskId = extractRealTaskId(info.taskId);
      const task = taskIndex.get(realTaskId);
      if (!task) return;
      const oldStart = parseISO(task.startDate);
      const oldEnd = task.endDate ? parseISO(task.endDate) : oldStart;
      let newStart = oldStart;
      let newEnd = oldEnd;
      if (info.edge === "left") {
        newStart = addDays(oldStart, info.deltaDays);
        if (newStart > newEnd) return; // keeps the start <= end invariant
      } else {
        newEnd = addDays(oldEnd, info.deltaDays);
        if (newEnd < newStart) return;
      }
      const newStartStr = format(newStart, "yyyy-MM-dd");
      const newEndStr = format(newEnd, "yyyy-MM-dd");
      // Vehicle/resource pseudo-tasks → dedicated API
      if (info.taskId.startsWith("va:")) {
        updateVehicleAssignment.mutate({
          id: info.taskId.slice(3),
          data: { startDate: newStartStr, endDate: newEndStr },
        });
        return;
      }
      if (info.taskId.startsWith("ra:")) {
        updateResourceAssignment.mutate({
          id: info.taskId.slice(3),
          data: { startDate: newStartStr, endDate: newEndStr },
        });
        return;
      }
      // No animation on release: the 150 ms hold in use-canvas-pointer
      // already handles the seamless preview → updated cached bar transition.
      resizeTask.mutate({
        id: realTaskId,
        data: { startDate: newStartStr, endDate: newEndStr },
      });
    },
    [resizeTask, taskIndex, updateVehicleAssignment, updateResourceAssignment]
  );

  useCanvasPointer({
    canvasNode: interactiveCanvas,
    containerNode,
    viewport,
    hitTest,
    dragStateRef,
    isDragActiveRef,
    hoveredTaskIdRef,
    hoveredCellRef,
    requestStaticRedraw,
    onScroll: handleScroll,
    onTaskClick: handleTaskClick,
    onCellClick: handleCellClick,
    onTaskContextMenu: handleTaskContextMenu,
    onCellContextMenu: handleCellContextMenu,
    onDragComplete: handleDragComplete,
    onResizeComplete: handleResizeComplete,
    onPointerDownIntercept: () => {
      // If a context menu or a DropActionMenu is open, the first
      // click closes it and stops the event (legacy parity + consistent UX:
      // no direct opening of a task dialog while a menu exists).
      if (contextMenu) {
        setContextMenu(null);
        return true;
      }
      if (dropInfo) {
        clearDrop();
        return true;
      }
      return false;
    },
    canDragTaskById,
    canResizeTaskById,
  });

  // ──────────────────────────────────────────────────────────────────
  // 9.quater Keyboard shortcuts (Ctrl+C / Ctrl+X / Ctrl+V)
  // ──────────────────────────────────────────────────────────────────
  /** Pointer position (viewport CSS pixels) — tracked for the
   *  shortcuts that copy/paste the element under the cursor. */
  const mousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  /** Mouse position for the "full band name" tooltip — state because
   *  it must trigger a re-render to follow the cursor. Updated
   *  only when a band is hovered to avoid useless
   *  renders. */
  const [groupTooltipPos, setGroupTooltipPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!containerNode) return;
    const onMove = (e: PointerEvent) => {
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      // The tooltip is only shown when hoveredGroupHeader is not null,
      // but we always update the position to follow it smoothly.
      setGroupTooltipPos({ x: e.clientX, y: e.clientY });
    };
    containerNode.addEventListener("pointermove", onMove);
    return () => containerNode.removeEventListener("pointermove", onMove);
  }, [containerNode]);

  /** Measures whether a band label is truncated (exceeds `sidebarWidth - 24`).
   *  Uses an off-screen canvas with the same font as `drawSidebar`
   *  to compare the actual width with the available max. */
  const groupLabelMeasureRef = useRef<HTMLCanvasElement | null>(null);
  const isGroupLabelTruncated = useCallback(
    (name: string) => {
      if (!name) return false;
      if (!groupLabelMeasureRef.current) {
        groupLabelMeasureRef.current = document.createElement("canvas");
      }
      const ctx = groupLabelMeasureRef.current.getContext("2d");
      if (!ctx) return false;
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      return ctx.measureText(name).width > computedSidebarWidth - 24;
    },
    [computedSidebarWidth]
  );

  useEffect(() => {
    if (!interactiveCanvas) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore shortcuts inside input fields
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
      const target2 = hitTest(x, y);
      if (key === "c" && target2.kind === "task") {
        e.preventDefault();
        const realId = extractRealTaskId(target2.taskId);
        handleCopyTaskClip(realId);
      } else if (key === "x" && target2.kind === "task") {
        e.preventDefault();
        const realId = extractRealTaskId(target2.taskId);
        handleCutTaskClip(realId);
      } else if (key === "v" && target2.kind === "cell" && clipboardTask) {
        e.preventDefault();
        handlePasteAtCell(target2.rowId, target2.dateStr);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    interactiveCanvas,
    hitTest,
    handleCopyTaskClip,
    handleCutTaskClip,
    handlePasteAtCell,
    clipboardTask,
  ]);

  // ──────────────────────────────────────────────────────────────────
  // 9.quinquies Socket.io — real-time sync of remote changes
  // (parity with legacy scheduler-grid.tsx)
  // ──────────────────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { connected } = useSocket();
  useEffect(() => {
    if (!SOCKET_ENABLED || !connected) return;
    type TaskCachePage = { data: unknown[]; total: number };
    type RemoteTaskEvent = { action?: string; taskId?: string; taskIds?: string[] };
    const handleTaskChanged = async (event?: RemoteTaskEvent) => {
      // ── Deletions: remove from every list locally, no
      // refetch needed. The individual query is purged FIRST
      // to avoid a 404 if a `useTask(deletedId)` component is
      // still mounted (closing modal, etc.).
      if (event?.action === "deleted" && event.taskId) {
        const deletedId = event.taskId;
        queryClient.removeQueries({ queryKey: ["tasks", deletedId], exact: true });
        queryClient.setQueriesData<TaskCachePage>({ queryKey: ["tasks"] }, (old) => {
          if (!old?.data) return old;
          const filtered = old.data.filter((t) => (t as { id: string }).id !== deletedId);
          return { ...old, data: filtered, total: Math.max(0, old.total - (old.data.length - filtered.length)) };
        });
        return;
      }
      if (event?.action === "bulk-deleted" && event.taskIds) {
        const ids = new Set(event.taskIds);
        for (const id of event.taskIds) {
          queryClient.removeQueries({ queryKey: ["tasks", id], exact: true });
        }
        queryClient.setQueriesData<TaskCachePage>({ queryKey: ["tasks"] }, (old) => {
          if (!old?.data) return old;
          const filtered = old.data.filter((t) => !ids.has((t as { id: string }).id));
          return { ...old, data: filtered, total: Math.max(0, old.total - (old.data.length - filtered.length)) };
        });
        return;
      }
      // ── Creation / update / move / resize / copy of a
      // remote task: we fetch ONLY that task (~5 KB) and
      // merge it into the cache. Avoids the global refetch of /api/tasks
      // (~5 MB) that caused a ~1 second display delay.
      if (event?.taskId) {
        try {
          const res = await fetch(`/api/tasks/${event.taskId}`);
          if (!res.ok) return;
          const task = (await res.json()) as { id: string };
          queryClient.setQueriesData<TaskCachePage>({ queryKey: ["tasks"] }, (old) => {
            if (!old?.data) return old;
            const idx = old.data.findIndex((t) => (t as { id: string }).id === task.id);
            if (idx >= 0) {
              const next = old.data.slice();
              next[idx] = task;
              return { ...old, data: next };
            }
            return { ...old, data: [...old.data, task], total: old.total + 1 };
          });
          queryClient.setQueryData(["tasks", task.id], task);
        } catch {
          // Fallback: if the fetch fails, invalidate to reconverge
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      } else {
        // Event without taskId (generic bulk update): global invalidate
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
      // Dependent queries (vehicle / resource icons on the bars,
      // project summaries) — vehicle/resource are required
      // for the canvas (icons), hence an active refetch. Projects are lazy
      // (refetchType: "none") because of the big payload + only /projects
      // really needs it → refetch when that screen mounts again.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["vehicle-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["resource-assignments"] });
    };
    const handleConnect = () => {
      // On reconnect, we do not know what we missed → global refetch.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    };
    socket.on("task:changed", handleTaskChanged);
    socket.on("connect", handleConnect);
    return () => {
      socket.off("task:changed", handleTaskChanged);
      socket.off("connect", handleConnect);
    };
  }, [connected, queryClient]);

  // ──────────────────────────────────────────────────────────────────
  // 10. Radix tooltip on canvas bar
  // ──────────────────────────────────────────────────────────────────
  // State shared with the scrollbars section (declared here because
  // `useCanvasTooltip` below needs it via `disabled`).
  const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);
  // `isTouchDevice` is declared in the permissions section (8.quater).

  const { hoveredTaskId, hoveredSidebarRowId, tooltipAnchor, clearTooltip } = useCanvasTooltip({
    canvasNode: interactiveCanvas,
    containerNode,
    hitTest,
    anchorRef: tooltipAnchorRef,
    isDragActiveRef,
    // Also hides tooltips when a context menu is open,
    // and always on mobile (no hover, only tap).
    disabled: isScrollbarDragging || contextMenu !== null || dropInfo !== null || isTouchDevice,
  });

  // Users view: the tooltip reports the compound `${taskId}:${userId}` —
  // extract the real task UUID to find the task.
  const realHoveredTaskId = hoveredTaskId
    ? extractRealTaskId(hoveredTaskId)
    : null;
  const hoveredTask = realHoveredTaskId ? taskIndex.get(realHoveredTaskId) : null;
  const hoveredSidebarRow = hoveredSidebarRowId
    ? sortedRows.find((r) => r.id === hoveredSidebarRowId && r.type !== "header")
    : null;
  const hoveredGroupHeader = hoveredSidebarRowId
    ? sortedRows.find((r) => r.id === hoveredSidebarRowId && r.type === "header")
    : null;

  // ──────────────────────────────────────────────────────────────────
  // 11. A11y — DOM mirror + keyboard shortcuts
  // ──────────────────────────────────────────────────────────────────
  const visibleTaskIds = useMemo(() => getVisibleTaskIds(), [
    // Recomputes when the viewport changes (scroll, resize)
    scrollX, scrollY, size, getVisibleTaskIds,
  ]);
  const { focusedTaskId, setFocusedTaskId, liveMessage } = useCanvasA11y({
    visibleTaskIds,
    onActivate: handleTaskClick,
  });

  // ──────────────────────────────────────────────────────────────────
  // 11.bis Custom scrollbars (overlay)
  //
  // Why: canvases have no native scrollbars — scrolling is
  // handled by the useCanvasPointer wheel handler, which mutates scrollX/Y.
  // We draw two draggable thumbs (h at the bottom, v on the right) that
  // sync their position with the existing state. Pages
  // stay scrollable with wheel/trackpad; these thumbs only add
  // the missing visual feedback.
  // ──────────────────────────────────────────────────────────────────
  const MIN_THUMB = 36;
  const totalContentW = dayCount * cellWidth;
  const totalContentH = getTotalContentHeight();
  const viewportContentW = Math.max(0, size.width - computedSidebarWidth);
  const viewportContentH = Math.max(0, size.height - CANVAS_GEOMETRY.headerHeight);
  const {
    maxX: maxScrollX,
    maxY: maxScrollY,
    showH: showHScrollbar,
    showV: showVScrollbar,
  } = gridScrollBounds(totalContentW, totalContentH, viewportContentW, viewportContentH, !isTouchDevice);
  // Horizontal track over the full grid width (names column
  // included), like the vertical track that covers the header.
  const hTrackW = Math.max(0, size.width - (showVScrollbar ? SCROLLBAR_SIZE : 0));
  // Vertical track over the full grid height (header included), like
  // a native scrollbar; only the scrollable content stays below the header.
  const vTrackH = Math.max(0, size.height - (showHScrollbar ? SCROLLBAR_SIZE : 0));
  const hThumbWidth = scrollThumbLength(viewportContentW, maxScrollX, hTrackW, MIN_THUMB);
  const hThumbX = maxScrollX === 0 ? 0 : (scrollX / maxScrollX) * (hTrackW - hThumbWidth);
  const vThumbHeight = scrollThumbLength(viewportContentH, maxScrollY, vTrackH, MIN_THUMB);
  const vThumbY = maxScrollY === 0 ? 0 : (scrollY / maxScrollY) * (vTrackH - vThumbHeight);

  const scrollbarDragRef = useRef<{
    axis: "h" | "v";
    startPointer: number;
    startScroll: number;
  } | null>(null);
  // `isScrollbarDragging` is declared above (before useCanvasTooltip).

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

  // ──────────────────────────────────────────────────────────────────
  // 11.ter Computation of the can* props for the menus (scheduler-grid parity)
  // ──────────────────────────────────────────────────────────────────
  const ctxTask: TaskWithUsers | null = contextMenu?.taskId
    ? (taskIndex.get(contextMenu.taskId) ?? null)
    : null;
  const ctxRow: GridRow | null = contextMenu?.rowId
    ? ((sortedRows.find((r) => r.id === contextMenu.rowId) as GridRow) ?? null)
    : null;
  const menuCanCreate =
    (() => {
      if (viewMode === "vehicles") return can("vehicles:create");
      if (viewMode === "resources") return can("resources:create");
      if (!canCreateAnyTask) return false;
      if (
        ctxRow &&
        ctxRow.type === "row" &&
        !canCreateOnPlanningRow(viewMode, ctxRow)
      ) {
        return false;
      }
      const dateStr = contextMenu?.dateStr;
      if (viewMode === "users" && contextMenu?.rowId && dateStr && dailyLimit > 0) {
        if (
          wouldExceedDailyLimit(tasks, dailyLimit, {
            userIds: [contextMenu.rowId],
            startDate: dateStr,
          })
        ) {
          return false;
        }
      }
      return true;
    })();
  const menuCanEdit =
    (() => {
      // Vehicles/resources pseudo-tasks: specific permission
      if (contextMenu?.taskId?.startsWith("va:")) return can("vehicles:edit");
      if (contextMenu?.taskId?.startsWith("ra:")) return can("resources:edit");
      if (!ctxTask) return true;
      if (ctxTask.isLocked) return false;
      return canModifyTask(ctxTask);
    })();
  const menuCanCopy = canCreateAnyTask;
  const menuCanCut =
    (() => {
      if (!ctxTask) return can("tasks:move");
      if (ctxTask.isLocked) return false;
      return canMoveTask(ctxTask);
    })();
  const menuCanDelete =
    (() => {
      // Vehicles/resources pseudo-tasks: specific permission
      if (contextMenu?.taskId?.startsWith("va:")) return can("vehicles:delete");
      if (contextMenu?.taskId?.startsWith("ra:")) return can("resources:delete");
      if (!ctxTask) return true;
      if (ctxTask.isLocked) return false;
      return canDeleteTask(ctxTask);
    })();
  const menuCanPaste =
    (() => {
      if (!clipboardTask) return false;
      const source = taskIndex.get(clipboardTask.taskId);
      if (clipboardTask.mode === "copy") {
        if (!canCreateAnyTask) return false;
      } else {
        if (!source || source.isLocked || !canMoveTask(source)) return false;
      }
      if (ctxRow && ctxRow.type === "row" && !canCreateOnPlanningRow(viewMode, ctxRow)) {
        return false;
      }
      return true;
    })();
  const menuCanLock = ctxTask ? canLockTask(ctxTask) : false;

  // DropActionMenu: on a drop (Move/Copy), validate the source + destination.
  const dropSource: TaskWithUsers | null = dropInfo
    ? (taskIndex.get(dropInfo.taskId) ?? null)
    : null;
  const dropDestRow: GridRow | null = dropInfo?.targetRowId
    ? ((sortedRows.find((r) => r.id === dropInfo.targetRowId) as GridRow) ?? null)
    : null;
  const dropDestAllowed =
    !dropDestRow ||
    dropDestRow.type !== "row" ||
    canCreateOnPlanningRow(viewMode, dropDestRow);
  const dropCanMove =
    !!dropSource && canMoveTask(dropSource) && dropDestAllowed;
  const dropCanCopy = canCreateAnyTask && dropDestAllowed;

  // Silences the "modifyScope unused" warning
  void modifyScope;

  // ──────────────────────────────────────────────────────────────────
  // 12. Early returns
  // ──────────────────────────────────────────────────────────────────
  // The initial loading skeleton is rendered by the parent (page.tsx)
  // before this component even mounts. If this component is mounted,
  // rows + the first tasks response have already arrived (cache ready). So we
  // render the canvas directly. The in-cell wave skeleton (Pass 2.5
  // of drawTasks) stays active for later refetches (period
  // change, socket invalidation).
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
        <GridToolbar onCreateTask={() => { setEditingTaskId(null); setPrefillData(null); setDialogOpen(true); }} />

        {/* flex-1 wrapper + h-full w-full child: pattern validated by the
            POC. With `flex-1` directly on containerRef, the flex layout
            does not propagate the height through the `h-full → flex-1
            → h-full → flex-1` chain (unknown cause, probably related to
            `animate-in fade-in` + nested layers). */}
        <div className={showSummary ? "flex flex-1 flex-col overflow-hidden" : "relative flex-1 overflow-hidden"}>
        <div ref={setContainerRef} className={showSummary ? "relative flex-1 min-h-0 overflow-hidden bg-background" : "relative h-full w-full overflow-hidden bg-background"}>
          <canvas
            ref={setStaticCanvas}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 1,
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={setInteractiveCanvas}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 2,
              cursor: "default",
              // touch-action: none → prevents the browser from scrolling
              // the page on a finger swipe over the canvas. Touch pan
              // is handled manually in `useCanvasPointer`.
              touchAction: "none",
            }}
          />

          {/* Ghost anchor — used for the tooltips. The position
              in screen coords (clientX/Y) is read from tooltipAnchor. */}
          <CanvasTooltipAnchor ref={tooltipAnchorRef} />

          {/* Controlled TaskTooltip — drives visible/anchor from the
              canvas hit-test. The internal portal handles the rendering. */}
          {hoveredTask && (
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

          {/* Rich sidebar tooltip based on the current viewMode.
              Positioned right of the sidebar (legacy parity `rect.right + 8`),
              vertically centered on the row. `controlled` mode (no
              cloneElement) because the bar lives in the canvas. */}
          {hoveredSidebarRow && (() => {
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
            if (viewMode === "vehicles") {
              return (
                <VehicleTooltip
                  vehicle={hoveredSidebarRow as Parameters<typeof VehicleTooltip>[0]["vehicle"]}
                  controlled={{ visible: true, pos: sidebarPos }}
                >
                  <span style={{ display: "none" }} />
                </VehicleTooltip>
              );
            }
            return null;
          })()}

          {/* Simple tooltip on the group bands (business unit / team) —
              shows the full name ONLY when the label is truncated
              in the sidebar (otherwise it is already fully visible).
              Position: next to the cursor (+14 px offset) to follow the
              mouse, like the native tooltips of the site tables. */}
          {hoveredGroupHeader &&
            isGroupLabelTruncated(hoveredGroupHeader.name ?? "") &&
            groupTooltipPos &&
            contextMenu === null &&
            dropInfo === null &&
            !isTouchDevice && (
              <div
                role="tooltip"
                style={{
                  position: "fixed",
                  left: groupTooltipPos.x + 14,
                  top: groupTooltipPos.y + 14,
                  zIndex: 50,
                  pointerEvents: "none",
                }}
                className="rounded-md bg-popover text-popover-foreground border border-border/60 shadow-md px-2 py-1 text-xs font-medium animate-in fade-in-0 zoom-in-95 duration-100"
              >
                {hoveredGroupHeader.name}
              </div>
            )}

          {/* Accessible DOM mirror */}
          <CanvasA11yMirror
            visibleTaskIds={visibleTaskIds}
            taskIndex={taskIndex}
            focusedTaskId={focusedTaskId}
            setFocusedTaskId={setFocusedTaskId}
            onActivate={handleTaskClick}
            liveMessage={liveMessage}
          />

          {/* Horizontal scrollbar (overlay at the bottom, full width). The
              track lets events through; only the thumb captures. */}
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
                // pointerEvents auto so that `onPointerEnter` fires
                // as soon as we enter the scrollbar area (otherwise `none`
                // would also block this event, and the tooltip would stay
                // visible when moving away from the canvas).
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

          {/* Corner filler — hides the transparent bottom-right square
              where the two scrollbars meet. */}
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

        {showSummary && (
          <SummaryTable
            rows={sortedRows
              .filter((r) => r.type === "row")
              .map((r) => {
                let label = r.name ?? "";
                if (viewMode === "users") {
                  const suffix = getContractSuffix(
                    (r as { contractType?: string | null }).contractType,
                    (key) => tDyn(tUsers, `contractTypes.${key}`),
                  );
                  if (suffix) label = `${label} [${suffix}]`;
                }
                return { id: r.id, label };
              })}
            tasks={tasks}
            rowKey={
              viewMode === "users"
                ? "users"
                : viewMode === "projects"
                ? "projectId"
                : viewMode === "places"
                ? "placeId"
                : viewMode === "resources"
                ? "resourceId"
                : "vehicleId"
            }
            width={`calc(${computedSidebarWidth}px + ${dayCount * cellWidth}px)`}
          />
        )}
        </div>

        {/* Edit / create modal — React DOM intact */}
        <TaskFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          taskId={editingTaskId}
          prefill={prefillData}
          viewMode={viewMode}
        />

        {/* Drop action menu (Move / Copy) — appears at the cursor after drop */}
        <DropActionMenu
          position={dropInfo?.dropPosition ?? null}
          isMultiUser={
            dropInfo
              ? (taskIndex.get(dropInfo.taskId)?.users?.length ?? 0) > 1
              : false
          }
          canMove={dropCanMove}
          canCopy={dropCanCopy}
          onClose={clearDrop}
          onMove={handleDropMove}
          onMoveUser={viewMode === "users" ? handleDropMoveUser : undefined}
          onCopy={handleDropCopy}
          onAddUser={(() => {
            // Shown if users view + multi-user task + drop on another user.
            if (viewMode !== "users" || !dropInfo?.targetRowId) return undefined;
            if (dropInfo.targetRowId === dropInfo.sourceRowId) return undefined;
            const sourceTask = taskIndex.get(dropInfo.taskId);
            const isMulti = (sourceTask?.users?.length ?? 0) > 1;
            if (!isMulti) return undefined;
            // If the target user is already in the task → no "add" option
            const alreadyHas = sourceTask?.users?.some((u) => u.id === dropInfo.targetRowId);
            if (alreadyHas) return undefined;
            return handleDropAddUser;
          })()}
          addUserOnly={
            // Case A: multi-user + cross-user + same day → ONLY "Add this user".
            viewMode === "users" &&
            !!dropInfo &&
            dropInfo.deltaDays === 0 &&
            !!dropInfo.targetRowId &&
            dropInfo.targetRowId !== dropInfo.sourceRowId &&
            (taskIndex.get(dropInfo.taskId)?.users?.length ?? 0) > 1
          }
        />

        {/* Context menu (right-click on bar or cell) */}
        <PlanningContextMenu
          state={contextMenu}
          onClose={closeContextMenu}
          hasClipboard={!!clipboardTask}
          isMultiUser={
            contextMenu?.taskId
              ? (taskIndex.get(contextMenu.taskId)?.users?.length ?? 0) > 1
              : false
          }
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
          onCreateTask={handleCreateAtCell}
          onPaste={handlePasteAtCell}
        />

        {/* Multi-user delete dialog (legacy scheduler-grid parity) */}
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
            const scope = pendingRecurScope?.scope;
            const id = multiDeleteState.taskId;
            // Clear editingTaskId if the deleted task is currently being
            // edited → avoids a GET /api/tasks/{id} → 404 issued by
            // useTask(editingTaskId) after removal from the cache.
            if (editingTaskId === id) setEditingTaskId(null);
            startDeleteAnimation(id);
            setMultiDeleteState(null);
            setPendingRecurScope(null);
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

        {/* Recurrence delete dialog (scope single/all/before/after) */}
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
              startDeleteAnimation(id);
              setRecurDeleteState(null);
              setTimeout(() => deleteTask.mutate({ id, scope }), 130);
            }
          }}
        />

        {/* Vehicle reservation dialog (vehicles view) */}
        {vehicleReserveOpen && (
          <VehicleReserveDialog
            open={vehicleReserveOpen}
            onOpenChange={setVehicleReserveOpen}
            assignmentId={editingAssignmentId}
            prefillVehicleId={vehicleReservePrefill?.vehicleId}
            prefillDate={vehicleReservePrefill?.date}
          />
        )}

        {/* Resource assignment dialog (resources view) */}
        {resourceReserveOpen && (
          <ResourceReserveDialog
            open={resourceReserveOpen}
            onOpenChange={setResourceReserveOpen}
            assignmentId={editingResourceAssignmentId}
            prefillResourceId={resourceReservePrefill?.resourceId}
            prefillDate={resourceReservePrefill?.date}
          />
        )}

        {/* Ctrl+C/X/V mini feedback — animated badge near the cursor. */}
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
            {clipFeedback.type === "copy" && (
              <>
                <ClipboardCopy />
                {t("clipboard.copied")}
              </>
            )}
            {clipFeedback.type === "cut" && (
              <>
                <Scissors />
                {t("clipboard.cut")}
              </>
            )}
            {clipFeedback.type === "paste" && (
              <>
                <ClipboardPaste />
                {t("clipboard.pasted")}
              </>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
