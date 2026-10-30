"use client";

import { useCallback, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { contrastColor } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import { TaskTooltip } from "./task-tooltip";
import { usePlanningStore } from "@/stores/planning-store";
import { usePermissions } from "@/hooks/use-permissions";
import type { TaskWithUsers } from "@/types";

// Global flag to suppress clicks during/after resize
let _resizingGlobal = false;
export function isCalendarResizing() { return _resizingGlobal; }


interface CalendarTaskBlockProps {
  task: TaskWithUsers;
  top: number;
  height: number;
  left: number;
  width: number;
  onClick: (taskId: string) => void;
  onContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  onResize?: (taskId: string, startTime: string, endTime: string) => void;
  totalHeight: number;
  totalMinutes: number;
  firstHour: number;
  columnId: string; // used for draggable id uniqueness
  dateStr?: string; // used for resize preview scoping
}

/** Darken a hex color by a percentage (0-1). */
function darkenColor(hex: string, amount: number): string {
  const c = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(c.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(c.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(c.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function CalendarTaskBlock({
  task,
  top,
  height,
  left,
  width,
  onClick,
  onContextMenu,
  onResize,
  totalHeight,
  totalMinutes,
  firstHour,
  columnId,
  dateStr,
}: CalendarTaskBlockProps) {
  const isDeleting = usePlanningStore((s) => s.deletingTaskIds.has(task.id));
  const { formatTime: formatTimeLabel } = useDateFormat();
  const bgColor = task.project?.color || "#9ca3af";
  const textColor = contrastColor(bgColor);
  const borderColor = darkenColor(bgColor, 0.25);
  const effectiveHeight = Math.max(height, 24);

  // Permissions: modifyScope is applied through canMoveTask/canResizeTask.
  const { canMoveTask, canResizeTask, canCreateAnyTask } = usePermissions();
  const canDrag = (canMoveTask(task) || canCreateAnyTask) && task.isLocked !== true;
  const canResize = canResizeTask(task) && task.isLocked !== true;
  const draggableId = `cal:${task.id}:${columnId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { taskId: task.id, rowId: columnId },
    disabled: !canDrag,
  });
  const pendingDrop = usePlanningStore((s) => s.pendingDrop);
  const setResizePreview = usePlanningStore((s) => s.setResizePreview);
  const isPendingSource = pendingDrop?.taskId === task.id;

  // Resize state
  const resizingRef = useRef(false);
  const [resizeDelta, setResizeDelta] = useState<{ edge: "top" | "bottom"; rawPx: number } | null>(null);

  // Pixel height of one hour slot — used for snapping
  const slotPx = totalMinutes > 0 ? totalHeight / (totalMinutes / 60) : 60;

  const handleResizeStart = useCallback((e: React.MouseEvent, edge: "top" | "bottom") => {
    if (!onResize || !canResize) return;
    e.stopPropagation();
    e.preventDefault();
    resizingRef.current = true;
    _resizingGlobal = true;

    const startY = e.clientY;

    const parseMin = (t: string) => {
      const parts = t.split(":");
      return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
    };
    const startMin = task.startTime ? parseMin(task.startTime) : firstHour * 60;
    const endMin = task.endTime ? parseMin(task.endTime) : startMin + 60;

    // Compute snapped target hours from delta
    const computeTarget = (deltaY: number) => {
      // Use 0.3 threshold instead of 0.5 for easier snapping
      const deltaHours = deltaY >= 0
        ? Math.floor(deltaY / slotPx + 0.7)
        : Math.ceil(deltaY / slotPx - 0.7);
      const deltaMins = deltaHours * 60;
      let ns = startMin, ne = endMin;
      if (edge === "top") {
        ns = startMin + deltaMins;
        if (ns >= ne - 60) ns = ne - 60;
      } else {
        ne = endMin + deltaMins;
        if (ne <= ns + 60) ne = ns + 60;
      }
      ns = Math.max(0, Math.min(ns, 23 * 60));
      ne = Math.max(60, Math.min(ne, 24 * 60));
      return { startH: Math.floor(ns / 60), endH: Math.floor(ne / 60), changed: ns !== startMin || ne !== endMin, ns, ne };
    };

    const handleMouseMove = (me: MouseEvent) => {
      const deltaY = me.clientY - startY;
      setResizeDelta({ edge, rawPx: deltaY });
      // Update cell highlight preview via store
      const target = computeTarget(deltaY);
      setResizePreview({ columnId, dateStr, startHour: target.startH, endHour: target.endH });
    };

    const handleMouseUp = (me: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizeDelta(null);
      setResizePreview(null);

      // Keep resizing flag true briefly to suppress click events
      setTimeout(() => { resizingRef.current = false; _resizingGlobal = false; }, 150);

      const deltaY = me.clientY - startY;
      const target = computeTarget(deltaY);
      if (!target.changed) return;

      const formatTime = (m: number) => {
        const h = Math.floor(m / 60);
        return `${String(h).padStart(2, "0")}:00`;
      };

      onResize(task.id, formatTime(target.ns), formatTime(target.ne));
    };

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [onResize, canResize, task, slotPx, firstHour, columnId, dateStr, setResizePreview]);

  const handleClick = useCallback(() => {
    if (resizingRef.current) return;
    onClick(task.id);
  }, [onClick, task.id]);

  // Apply live resize delta (smooth, snaps on release)
  let renderTop = top;
  let renderHeight = effectiveHeight;
  const isResizing = !!resizeDelta;
  if (resizeDelta) {
    if (resizeDelta.edge === "top") {
      renderTop = top + resizeDelta.rawPx;
      renderHeight = effectiveHeight - resizeDelta.rawPx;
    } else {
      renderHeight = effectiveHeight + resizeDelta.rawPx;
    }
    renderHeight = Math.max(renderHeight, 20);
  }

  return (
    <TaskTooltip
      task={{
        ...task,
        createdAt: task.createdAt ? String(task.createdAt) : null,
        updatedAt: task.updatedAt ? String(task.updatedAt) : null,
      }}
      project={task.project}
      status={task.status}
    >
      <div
        ref={setNodeRef}
        data-task-id={task.id}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu?.(e, task.id);
        }}
        className={`absolute cursor-pointer overflow-hidden hover:brightness-110 group/task select-none ${isResizing ? "" : "transition-[top,height,filter] duration-150"} ${isDeleting ? "task-deleting" : ""}`}
        style={{
          top: renderTop,
          left: `${left}%`,
          width: `${width}%`,
          height: renderHeight,
          backgroundColor: bgColor,
          color: textColor,
          // Calendar view: the bar has no half-day gradient
          // (solid color), so no readability override to apply.
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 3,
          boxShadow: isResizing
            ? "0 2px 8px rgba(0,0,0,0.2)"
            : isDragging
              ? "0 1px 2px rgba(0,0,0,0.1)"
              : "inset 0 0 0 1px var(--task-bar-border, rgba(0,0,0,0.08)), 0 1px 2px rgba(0,0,0,0.1)",
          zIndex: 2,
          padding: "1px 6px",
          boxSizing: "border-box",
          opacity: isDragging ? 0.3 : isPendingSource ? 0.35 : 1,
        }}
        {...listeners}
        {...attributes}
      >
        {/* Top resize handle */}
        {onResize && canResize && (
          <div
            className="absolute left-0 top-0 w-full h-1.5 cursor-ns-resize opacity-0 group-hover/task:opacity-100 transition-opacity rounded-t-sm"
            style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => handleResizeStart(e, "top")}
          />
        )}

        {task.project?.name && (
          <div
            className="truncate text-[10px] font-semibold leading-tight"
            style={{ color: textColor }}
          >
            {task.project.name}
          </div>
        )}
        {task.title && <div className="truncate text-xs leading-tight">{task.title}</div>}
        {renderHeight > 40 && (task.startTime || task.endTime) && (
          <div className="truncate text-[10px] leading-tight opacity-70">
            {formatTimeLabel(task.startTime)}
            {task.startTime && task.endTime ? " \u2013 " : ""}
            {formatTimeLabel(task.endTime)}
          </div>
        )}

        {/* Bottom resize handle */}
        {onResize && canResize && (
          <div
            className="absolute left-0 bottom-0 w-full h-1.5 cursor-ns-resize opacity-0 group-hover/task:opacity-100 transition-opacity rounded-b-sm"
            style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => handleResizeStart(e, "bottom")}
          />
        )}
      </div>
    </TaskTooltip>
  );
}
