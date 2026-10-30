"use client";

import { useCallback, useRef, useState } from "react";
import { useResizeTask } from "@/hooks/use-tasks";
import { usePlanningStore } from "@/stores/planning-store";
import { addDays, format, parseISO } from "date-fns";

interface TaskBarResizableProps {
  taskId: string;
  startDate: string;
  endDate: string;
  rowId: string;
  children: React.ReactNode;
}

// Global flag to suppress clicks after resize
let _ganttResizing = false;
export function isGanttResizing() { return _ganttResizing; }

export function TaskBarResizable({
  taskId,
  startDate,
  endDate,
  rowId,
  children,
}: TaskBarResizableProps) {
  const { cellWidth } = usePlanningStore();
  const setGanttResizePreview = usePlanningStore((s) => s.setGanttResizePreview);
  const resizeTask = useResizeTask();
  const [resizePx, setResizePx] = useState<{ side: "left" | "right"; px: number } | null>(null);
  const resizingRef = useRef(false);

  const computeDays = useCallback((deltaX: number) => {
    return Math.round(deltaX / cellWidth);
  }, [cellWidth]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, side: "left" | "right") => {
      e.stopPropagation();
      e.preventDefault();
      resizingRef.current = true;
      _ganttResizing = true;
      const startX = e.clientX;

      const handleMouseMove = (me: MouseEvent) => {
        const deltaX = me.clientX - startX;
        const days = computeDays(deltaX);
        setResizePx({ side, px: days * cellWidth });
        // Publish preview for cell highlighting
        let previewStart = startDate;
        let previewEnd = endDate;
        if (side === "right") {
          previewEnd = format(addDays(parseISO(endDate), days), "yyyy-MM-dd");
        } else {
          previewStart = format(addDays(parseISO(startDate), days), "yyyy-MM-dd");
        }
        if (previewStart <= previewEnd) {
          setGanttResizePreview({ rowId, startDate: previewStart, endDate: previewEnd });
        }
      };

      const handleMouseUp = (me: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setResizePx(null);
        setGanttResizePreview(null);

        setTimeout(() => { resizingRef.current = false; _ganttResizing = false; }, 150);

        const deltaX = me.clientX - startX;
        const daysDelta = computeDays(deltaX);
        if (daysDelta === 0) return;

        if (side === "right") {
          const newEnd = addDays(parseISO(endDate), daysDelta);
          if (newEnd < parseISO(startDate)) return;
          resizeTask.mutate({ id: taskId, data: { endDate: format(newEnd, "yyyy-MM-dd") } });
        } else {
          const newStart = addDays(parseISO(startDate), daysDelta);
          if (newStart > parseISO(endDate)) return;
          resizeTask.mutate({ id: taskId, data: { startDate: format(newStart, "yyyy-MM-dd"), endDate } });
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [cellWidth, taskId, startDate, endDate, rowId, resizeTask, computeDays, setGanttResizePreview]
  );

  // Snapped visual feedback
  const isResizing = !!resizePx;
  let style: React.CSSProperties = {};
  if (resizePx && resizePx.px !== 0) {
    if (resizePx.side === "right") {
      style = { width: `calc(100% + ${resizePx.px}px)` };
    } else {
      style = {
        transform: `translateX(${resizePx.px}px)`,
        width: `calc(100% - ${resizePx.px}px)`,
      };
    }
  }

  return (
    <div
      className="group relative"
      style={{
        ...style,
        boxShadow: isResizing ? "0 2px 8px rgba(0,0,0,0.18)" : undefined,
        transition: isResizing ? "width 80ms ease-out, transform 80ms ease-out" : "box-shadow 150ms ease-out",
        zIndex: isResizing ? 10 : undefined,
      }}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-l-sm z-10 transition-opacity"
        onMouseDown={(e) => handleMouseDown(e, "left")}
      />
      {children}
      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-r-sm z-10 transition-opacity"
        onMouseDown={(e) => handleMouseDown(e, "right")}
      />
    </div>
  );
}
