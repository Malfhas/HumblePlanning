"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { usePlanningStore } from "@/stores/planning-store";
import { useDateFormat } from "@/hooks/use-date-format";
import { getTaskLabel } from "./task-bar";
import { differenceInCalendarDays, addDays, format } from "date-fns";
import { contrastColor } from "@/lib/utils";
import type { TaskWithUsers } from "@/types";

export interface DragCompleteInfo {
  taskId: string;
  sourceRowId?: string;
  newStartDate: string;
  newEndDate?: string;
  newStartTime?: string;
  newEndTime?: string;
  targetRowId?: string;
  dropPosition: { x: number; y: number };
}

interface GridDndContextProps {
  children: React.ReactNode;
  tasks: TaskWithUsers[];
  onDragComplete: (info: DragCompleteInfo) => void;
}

const NO_AUTO_SCROLL = { enabled: false };

// PointerSensor option stabilized at module level: otherwise, on every
// GridDndContext render, a new `{ distance: 8 }` object would be created
// → useSensor returns a new descriptor → useSensors a new array
// → `<DndContext sensors={...}>` gets a new ref → dnd-kit resets its
// internal sensors → drag state lost / frozen.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };

// Modifier that snaps the overlay so its top-left aligns with the cursor (+ small offset)
const snapToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!activatorEvent || !draggingNodeRect) return transform;
  const event = activatorEvent as MouseEvent;
  // Offset so the overlay appears slightly below-right of the cursor
  return {
    ...transform,
    x: event.clientX - draggingNodeRect.left + transform.x - 8,
    y: event.clientY - draggingNodeRect.top + transform.y - 8,
  };
};

function findCellAtPoint(x: number, y: number): string | null {
  // `elementsFromPoint` (plural) is needed here: the task bars are
  // rendered with `position: absolute` above the cells, so the top
  // element is often a bar. With `closest('[data-cell-id]')` we would
  // not reach the cell (absolute ancestor = row container, without
  // data-cell-id). Walking the stack always reaches the cell
  // underneath, which carries `data-cell-id`. Acceptable cost since it is already
  // throttled to 32ms (~30fps) upstream in `handleDragMove`.
  const elements = document.elementsFromPoint(x, y);
  for (const el of elements) {
    const cellId = (el as HTMLElement).dataset?.cellId;
    if (cellId) return cellId;
  }
  return null;
}

export function GridDndContext({ children, tasks, onDragComplete }: GridDndContextProps) {
  // Granular Zustand selectors: without them, `GridDndContext` subscribed to
  // the WHOLE store and re-rendered on every `setDragOverCell` (~30×/s during
  // a drag). `handleDragMove` was then recreated through `useCallback`
  // (changed deps), `<DndContext>` saw its handler mutate, and the internal
  // drag state could freeze. With primitive selectors, the
  // component only re-renders when a read value actually changes —
  // during a drag NONE of these values change, so 0 re-renders.
  const cellWidth = usePlanningStore((s) => s.cellWidth);
  const slotWidth = usePlanningStore((s) => s.slotWidth);
  const columnMode = usePlanningStore((s) => s.columnMode);
  const viewMode = usePlanningStore((s) => s.viewMode);
  const setDragOverCell = usePlanningStore((s) => s.setDragOverCell);
  const calendarMode = usePlanningStore((s) => s.calendarMode);
  const setDragTaskHours = usePlanningStore((s) => s.setDragTaskHours);
  const t = useTranslations("planning");
  const { formatHourLabel } = useDateFormat();
  const untitled = t("canvas.untitled");
  const [activeTask, setActiveTask] = useState<TaskWithUsers | null>(null);
  const lastCellRef = useRef<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const taskId = event.active.data?.current?.taskId ?? event.active.id;
      const task = tasks.find((t) => t.id === taskId);
      setActiveTask(task || null);
      // Compute task duration in hours for multi-cell highlight
      if (task?.startTime) {
        const startH = parseInt(task.startTime.split(":")[0], 10);
        const endH = task.endTime ? parseInt(task.endTime.split(":")[0], 10) : startH + 1;
        setDragTaskHours(Math.max(endH - startH, 1));
      } else {
        setDragTaskHours(1);
      }
    },
    [tasks, setDragTaskHours]
  );

  // Throttle drag move to reduce layout thrashing from elementsFromPoint.
  // 32ms ≈ ~30fps — smooth enough for cell highlighting without jank.
  const dragMoveTimerRef = useRef<number>(0);
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const now = performance.now();
      if (now - dragMoveTimerRef.current < 32) return;
      dragMoveTimerRef.current = now;

      const activator = event.activatorEvent as MouseEvent | undefined;
      if (!activator) return;

      const x = activator.clientX + event.delta.x;
      const y = activator.clientY + event.delta.y;
      const cellId = findCellAtPoint(x, y);

      if (cellId !== lastCellRef.current) {
        lastCellRef.current = cellId;
        setDragOverCell(cellId);
      }
    },
    [setDragOverCell]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const hoveredCellId = lastCellRef.current;
      lastCellRef.current = null;
      setDragOverCell(null);
      setDragTaskHours(1);

      if (!event.active || !event.delta) return;

      const taskId = (event.active.data?.current?.taskId ?? event.active.id) as string;
      const sourceRowId = event.active.data?.current?.rowId as string | undefined;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Use the hovered cell to determine target row and date
      let targetRowId: string | undefined;
      let newStart: Date;
      let newEnd: Date | undefined;

      let newStartTime: string | undefined;
      let newEndTime: string | undefined;

      if (hoveredCellId) {
        // cellId format: "rowId:dateStr" (day mode) or "rowId:dateStr:hour" (hour mode)
        const parts = hoveredCellId.split(":");
        const rowId = parts[0];
        const dateStr = parts[1];
        const hourPart = parts[2];
        const targetHour = hourPart != null && hourPart !== "allday" && !isNaN(parseInt(hourPart, 10)) ? parseInt(hourPart, 10) : undefined;
        targetRowId = rowId;
        newStart = new Date(dateStr);
        if (task.endDate) {
          const duration = differenceInCalendarDays(new Date(task.endDate), new Date(task.startDate));
          newEnd = addDays(newStart, duration);
        }
        // Compute new times if dropped on an hour cell
        if (targetHour != null) {
          const origStartH = task.startTime ? parseInt(task.startTime.split(":")[0], 10) : null;
          const origEndH = task.endTime ? parseInt(task.endTime.split(":")[0], 10) : null;
          const timeDuration = origStartH != null && origEndH != null ? origEndH - origStartH : 1;
          newStartTime = `${String(targetHour).padStart(2, "0")}:00`;
          newEndTime = `${String(targetHour + Math.max(timeDuration, 1)).padStart(2, "0")}:00`;
        }
      } else {
        // Fallback to delta-based calculation
        const unitWidth = columnMode === "hours" ? slotWidth : cellWidth;
        const unitsMoved = Math.round(event.delta.x / unitWidth);
        if (unitsMoved === 0) return;
        newStart = addDays(new Date(task.startDate), columnMode === "hours" ? 0 : unitsMoved);
        newEnd = task.endDate ? addDays(new Date(task.endDate), columnMode === "hours" ? 0 : unitsMoved) : undefined;
      }

      // Don't trigger if dropped on the exact same position
      const startStr = format(newStart, "yyyy-MM-dd");
      const sameDate = startStr === task.startDate;
      const sameTime = !newStartTime || newStartTime === task.startTime;
      const sameRow = !targetRowId || targetRowId === sourceRowId;
      if (sameDate && sameTime && sameRow) return;

      const activator = event.activatorEvent as MouseEvent | undefined;
      const dropPosition = activator
        ? { x: activator.clientX + event.delta.x, y: activator.clientY + event.delta.y }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

      onDragComplete({
        taskId,
        sourceRowId,
        newStartDate: startStr,
        newEndDate: newEnd ? format(newEnd, "yyyy-MM-dd") : undefined,
        newStartTime,
        newEndTime,
        targetRowId,
        dropPosition,
      });
    },
    [tasks, cellWidth, onDragComplete, setDragOverCell, setDragTaskHours]
  );

  const isCalendar = calendarMode !== "off";

  const overlayStyle = useMemo(() => {
    if (!activeTask) return undefined;

    const bgColor = activeTask.project?.color || "#3b82f6";

    if (isCalendar) {
      // Calendar mode: show a compact card-like overlay
      return {
        width: 160,
        height: "auto" as const,
        backgroundColor: bgColor,
      };
    }

    if (columnMode === "hours") {
      const startH = activeTask.startTime ? parseInt(activeTask.startTime.split(":")[0], 10) : 0;
      const endH = activeTask.endTime ? parseInt(activeTask.endTime.split(":")[0], 10) : startH + 1;
      const spanHours = Math.max(endH - startH, 1);
      return {
        width: Math.max(spanHours * slotWidth - 6, slotWidth - 6),
        height: 24,
        backgroundColor: bgColor,
      };
    }

    const spanDays = activeTask.endDate
      ? differenceInCalendarDays(new Date(activeTask.endDate), new Date(activeTask.startDate)) + 1
      : 1;

    return {
      width: Math.max(spanDays * cellWidth - 4, 12),
      height: 24,
      backgroundColor: bgColor,
    };
  }, [activeTask, cellWidth, slotWidth, columnMode, isCalendar]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      autoScroll={NO_AUTO_SCROLL}
    >
      {children}
      <DragOverlay dropAnimation={null} zIndex={9999} modifiers={isCalendar ? [snapToCursor] : undefined} style={{ willChange: "transform" }}>
        {activeTask && overlayStyle && (
          isCalendar ? (
            <div
              className="rounded-md px-2.5 py-1.5 shadow-2xl ring-2 ring-white/30 pointer-events-none"
              style={{
                ...overlayStyle,
                color: contrastColor(activeTask.project?.color || "#3b82f6"),
                opacity: 0.9,
                cursor: "grabbing",
                borderLeft: "3px solid rgba(0,0,0,0.2)",
              }}
            >
              {activeTask.project?.name && (
                <div className="text-[10px] font-semibold leading-tight truncate opacity-90">
                  {activeTask.project.name}
                </div>
              )}
              {/* No title and no project: fallback title (otherwise the preview is empty). */}
              <div className="text-xs leading-tight truncate">
                {activeTask.title || (activeTask.project?.name ? null : untitled)}
              </div>
              {activeTask.startTime && (
                <div className="text-[10px] leading-tight truncate opacity-70">
                  {formatHourLabel(parseInt(activeTask.startTime.split(":")[0], 10))}
                  {activeTask.endTime ? ` – ${formatHourLabel(parseInt(activeTask.endTime.split(":")[0], 10))}` : ""}
                </div>
              )}
            </div>
          ) : (
            <div
              className="rounded-sm px-1.5 text-[11px] leading-6 truncate shadow-xl ring-2 ring-white/40 pointer-events-none"
              style={{
                ...overlayStyle,
                color: contrastColor(activeTask.project?.color || "#3b82f6"),
                opacity: 0.8,
                cursor: "grabbing",
              }}
            >
              {getTaskLabel(activeTask, viewMode, untitled)}
            </div>
          )
        )}
      </DragOverlay>
    </DndContext>
  );
}
