"use client";

import { useMemo, forwardRef, useCallback, useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { getTaskLabel as getTaskLabelBase } from "@/lib/utils/task-label";
import { cn, contrastColor, taskBarLabelFallbackColor, taskBarIconColor } from "@/lib/utils";
import { usePlanningStore } from "@/stores/planning-store";
import { differenceInCalendarDays, parseISO, addDays, format } from "date-fns";
import { getTaskTimeSlot, getTimeSlotBackground } from "@/lib/utils/time-slots";

import type { ViewMode } from "@/stores/planning-store";
import type { TaskFile } from "@/types";

interface TaskBarOwnProps {
  task: {
    id: string;
    title?: string | null;
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    isMilestone?: boolean;
    isLocked?: boolean;
    parentId?: string | null;
    files?: TaskFile[] | null;
    hasConflict?: boolean;
    vehicleNames?: string[];
    resourceNames?: string[];
    user?: { name?: string | null } | null;
    project?: { name?: string | null } | null;
    users?: { id: string; name?: string | null }[];
  };
  status?: {
    color?: string | null;
    displayMode?: string | null;
    strikethrough?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  } | null;
  project?: {
    color?: string | null;
  } | null;
  viewMode?: ViewMode;
  showUserCount?: boolean;
  showFileIcon?: boolean;
  slot: number;
  onClick?: (taskId: string) => void;
  onContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  onResize?: (taskId: string, startDate: string, endDate: string) => void;
  rowId?: string;
}

import { usePlanningConfig } from "@/hooks/use-planning-config";

const TASK_BAR_GAP = 4;

type TaskBarProps = TaskBarOwnProps & Omit<React.HTMLAttributes<HTMLDivElement>, "slot" | "onClick" | "onContextMenu">;

/** Label of a bar depending on the view (same logic as `@/lib/utils/task-label`).
 *  `untitled`: translated fallback title (`planning.canvas.untitled`); callers
 *  that do not pass it yet get an empty string. */
export function getTaskLabel(task: { title?: string | null; user?: { name?: string | null } | null; users?: { name?: string | null }[]; project?: { name?: string | null } | null }, viewMode?: ViewMode, untitled = ""): string {
  return getTaskLabelBase(task, viewMode, untitled);
}

export const TaskBar = forwardRef<HTMLDivElement, TaskBarProps>(
  function TaskBar({ task, status, project, viewMode, showUserCount, showFileIcon, slot, onClick, onContextMenu, onResize, rowId, className, style: styleProp, ...rest }, ref) {
    const { startDate: gridStart, endDate: gridEnd, cellWidth } = usePlanningStore();
    const { taskBarHeight, cellFontSize } = usePlanningConfig();
    const t = useTranslations("planning");
    const resizingRef = useRef(false);

    const computed = useMemo(() => {
      const taskStart = parseISO(task.startDate);
      const taskEnd = task.endDate ? parseISO(task.endDate) : taskStart;

      const offsetDays = differenceInCalendarDays(taskStart, gridStart);
      const spanDays = differenceInCalendarDays(taskEnd, taskStart) + 1;
      const totalGridDays = differenceInCalendarDays(gridEnd, gridStart) + 1;

      let left = offsetDays * cellWidth + 2;
      let width = Math.max(spanDays * cellWidth - 4, 12);
      const top = slot * (taskBarHeight + TASK_BAR_GAP) + 4;

      // Detect clipping
      const clippedLeft = offsetDays < 0;
      const clippedRight = offsetDays + spanDays > totalGridDays;

      // Clamp to visible bounds
      if (clippedLeft) {
        const visibleSpan = spanDays + offsetDays; // offsetDays is negative
        left = 2;
        width = Math.max(visibleSpan * cellWidth - 4, 12);
      }
      if (clippedRight) {
        const visibleEnd = totalGridDays - Math.max(offsetDays, 0);
        width = Math.max(visibleEnd * cellWidth - 4, 12);
      }

      const bgColor = project?.color || status?.color || "#3b82f6";
      const timeSlot = getTaskTimeSlot(task.startTime, task.endTime);
      const bgStyle = getTimeSlotBackground(timeSlot, bgColor);

      return { left, width, top, bgColor, timeSlot, bgStyle, offsetDays, spanDays, clippedLeft, clippedRight };
    }, [task, gridStart, gridEnd, cellWidth, slot, status, project, taskBarHeight]);

    const textStyle = useMemo(() => {
      const s: React.CSSProperties = {};
      if (status?.strikethrough) s.textDecoration = "line-through";
      if (status?.bold) s.fontWeight = "bold";
      if (status?.italic) s.fontStyle = "italic";
      if (status?.underline) {
        s.textDecoration = s.textDecoration
          ? `${s.textDecoration} underline`
          : "underline";
      }
      return s;
    }, [status]);

    // Live resize: raw pixel delta during drag (visual feedback)
    const [resizeDelta, setResizeDelta] = useState<{ edge: "left" | "right"; px: number } | null>(null);
    // After release: snapped delta held until mutation completes
    const [resizeHold, setResizeHold] = useState<{ edge: "left" | "right"; px: number } | null>(null);

    // The two-color gradient of the half-day label is now computed through
    // `useMemo` below (no offsetLeft DOM measurement). No ref or local
    // state needed anymore.
    const setGanttResizeActive = usePlanningStore((s) => s.setGanttResizeActive);
    const setGanttResizePreview = usePlanningStore((s) => s.setGanttResizePreview);

    const updateResizePreview = useCallback((newStart: Date, newEnd: Date) => {
      if (!rowId) return;
      setGanttResizePreview({
        rowId,
        startDate: format(newStart, "yyyy-MM-dd"),
        endDate: format(newEnd, "yyyy-MM-dd"),
      });
    }, [rowId, setGanttResizePreview]);

    const clearResizePreview = useCallback(() => {
      setGanttResizePreview(null);
    }, [setGanttResizePreview]);

    const handleResizeStart = useCallback((e: React.MouseEvent, edge: "left" | "right") => {
      if (!onResize || task.isLocked) return;
      e.stopPropagation();
      e.preventDefault();
      resizingRef.current = true;
      setGanttResizeActive(true);

      const startX = e.clientX;
      const taskStart = parseISO(task.startDate);
      const taskEnd = task.endDate ? parseISO(task.endDate) : taskStart;
      const spanDays = differenceInCalendarDays(taskEnd, taskStart) + 1;

      let lastPreviewDays = 0;

      const handleMouseMove = (me: MouseEvent) => {
        const deltaX = me.clientX - startX;
        const snappedDays = Math.round(deltaX / cellWidth);

        let clampedDays = snappedDays;
        if (edge === "right") clampedDays = Math.max(snappedDays, -(spanDays - 1));
        else clampedDays = Math.min(snappedDays, spanDays - 1);

        // Only update cell highlighting when snap changes
        if (clampedDays !== lastPreviewDays) {
          lastPreviewDays = clampedDays;
          if (clampedDays === 0) {
            // No change — no highlight
            clearResizePreview();
          } else if (edge === "right" && clampedDays > 0) {
            // Extending right: highlight from day after original end
            updateResizePreview(addDays(taskEnd, 1), addDays(taskEnd, clampedDays));
          } else if (edge === "right" && clampedDays < 0) {
            // Shrinking right: highlight the new last cell (where task will end)
            const newEnd = addDays(taskEnd, clampedDays);
            updateResizePreview(newEnd, newEnd);
          } else if (edge === "left" && clampedDays < 0) {
            // Extending left: highlight from new start to day before original start
            updateResizePreview(addDays(taskStart, clampedDays), addDays(taskStart, -1));
          } else if (edge === "left" && clampedDays > 0) {
            // Shrinking left: highlight the new first cell (where task will start)
            const newStart = addDays(taskStart, clampedDays);
            updateResizePreview(newStart, newStart);
          }
        }
        // Bar follows mouse with raw pixels (visual feedback like original)
        let clampedPx = deltaX;
        if (edge === "right") clampedPx = Math.max(deltaX, -(spanDays - 1) * cellWidth);
        else clampedPx = Math.min(deltaX, (spanDays - 1) * cellWidth);
        setResizeDelta({ edge, px: clampedPx });
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.removeAttribute("data-resizing");
        clearResizePreview();
        setResizeDelta(null);
        setGanttResizeActive(false);

        setTimeout(() => { resizingRef.current = false; }, 150);

        if (lastPreviewDays === 0) return;

        let newStart = taskStart;
        let newEnd = taskEnd;
        if (edge === "right") {
          newEnd = addDays(taskEnd, lastPreviewDays);
          if (newEnd < newStart) newEnd = newStart;
        } else {
          newStart = addDays(taskStart, lastPreviewDays);
          if (newStart > newEnd) newStart = newEnd;
        }

        // Set hold delta so bar animates to new size while mutation runs
        setResizeHold({ edge, px: lastPreviewDays * cellWidth });

        onResize(
          task.id,
          format(newStart, "yyyy-MM-dd"),
          format(newEnd, "yyyy-MM-dd")
        );
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.setAttribute("data-resizing", "");
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }, [onResize, task, cellWidth, updateResizePreview, clearResizePreview]);

    // Clear resize hold when task dates change (mutation applied)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setResizeHold(null); }, [task.startDate, task.endDate]);

    // Two-color gradient aligned on the bar for the half-day label.
    // OPTIMIZATION: the `useLayoutEffect` that read `span.offsetLeft`
    // is removed (synchronous forced reflow × N bars × N renders =
    // main bottleneck during scroll/drag). Instead, the span position is
    // **estimated** by summing the widths of the icons known at
    // compile time. The geometry is:
    //   px-1.5 (6px) + Σ(icon 12px + gap 4px) = 6 + 16×n_icons
    // Not pixel-perfect (icons can vary by 1-2 px depending on their path)
    // but visually indistinguishable and 0 DOM measurement. The gradient always
    // aligns at 50% of the bar — the only visible effect would be a slight
    // shift of the color/black transition point on the label, which stays
    // well within the correct area.
    const labelGradientStyle = useMemo<React.CSSProperties>(() => {
      const slot = computed.timeSlot;
      if (slot !== "morning" && slot !== "afternoon") return {};

      // Counts the icons displayed BEFORE the label in the JSX (see the order
      // of the `<svg>`s in the render below). The fileCount /
      // conflict / locked icons come AFTER the label, so they are not counted here.
      const ICON_WIDTH = 16; // 12 (h-3 w-3) + 4 (gap-1)
      const PADDING_LEFT = 6; // px-1.5
      const CLIPPING_INDICATOR = computed.clippedLeft ? ICON_WIDTH : 0;
      // Guaranteed by the guard on line 269: slot ∈ {"morning","afternoon"} → time icon always present.
      const TIME_INDICATOR = ICON_WIDTH;
      const PARENT_INDICATOR = task.parentId ? ICON_WIDTH : 0;
      const spanLeft =
        PADDING_LEFT + CLIPPING_INDICATOR + TIME_INDICATOR + PARENT_INDICATOR;

      const colored = contrastColor(computed.bgColor);
      const onWhite = "#000000";
      const gradient =
        slot === "morning"
          ? `linear-gradient(to right, ${colored} 50%, ${onWhite} 50%)`
          : `linear-gradient(to right, ${onWhite} 50%, ${colored} 50%)`;
      return {
        backgroundImage: gradient,
        backgroundSize: `${computed.width}px 100%`,
        backgroundPosition: `-${spanLeft}px 0`,
        backgroundRepeat: "no-repeat",
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
      };
    }, [
      computed.timeSlot,
      computed.bgColor,
      computed.width,
      computed.clippedLeft,
      task.parentId,
    ]);

    const handleClick = useCallback((e: React.MouseEvent) => {
      if (resizingRef.current) return;
      onClick?.(task.id);
    }, [onClick, task.id]);

    if (task.isMilestone) {
      return (
        <div
          ref={ref}
          className={cn("absolute flex items-center justify-center cursor-pointer", className)}
          style={{
            left: computed.left,
            top: computed.top,
            width: 20,
            height: taskBarHeight,
            ...styleProp,
          }}
          data-task-id={task.id}
          data-task-new={task.id.startsWith("__optimistic_") ? "" : undefined}
          onClick={handleClick}
          onContextMenu={(e) => onContextMenu?.(e, task.id)}
          {...rest}
        >
          <div
            className="h-3 w-3 rotate-45"
            style={{ backgroundColor: computed.bgColor }}
          />
        </div>
      );
    }

    const userCount = task.users?.length ?? 0;
    const label = getTaskLabel(task, viewMode, t("canvas.untitled"));

    // Apply live resize delta to position/width
    let renderLeft = computed.left;
    let renderWidth = computed.width;
    const isDragging = !!resizeDelta;
    // During drag: apply raw pixel delta (follows mouse)
    // After release: apply snapped hold delta (animated)
    const activeDelta = resizeDelta || resizeHold;
    if (activeDelta) {
      if (activeDelta.edge === "left") {
        renderLeft = computed.left + activeDelta.px;
        renderWidth = computed.width - activeDelta.px;
      } else {
        renderWidth = computed.width + activeDelta.px;
      }
      renderWidth = Math.max(renderWidth, cellWidth - 4);
    }

    return (
      <div
        ref={ref}
        className={cn(
          "absolute px-1.5 cursor-pointer",
          "hover:brightness-110 select-none",
          "flex items-center gap-1",
          "group/task",
          computed.clippedLeft && computed.clippedRight ? "" : computed.clippedLeft ? "rounded-r-sm" : computed.clippedRight ? "rounded-l-sm" : "rounded-sm",
          className
        )}
        style={{
          fontSize: cellFontSize,
          lineHeight: `${taskBarHeight}px`,
          left: renderLeft,
          top: computed.top,
          width: renderWidth,
          height: taskBarHeight,
          ...computed.bgStyle,
          // Global color inherited by the icons (SVG `currentColor`).
          // For half-day bars, the icons are left-aligned
          // so:
          //   - morning  → colored left area → background contrast
          //   - afternoon → white left area → always black
          // The label gets its own aligned two-color gradient through
          // `useLayoutEffect` below (see the label span).
          color: taskBarIconColor(computed.bgColor, computed.timeSlot),
          boxShadow: isDragging
            ? "0 2px 8px rgba(0,0,0,0.18)"
            : "inset 0 0 0 1px var(--task-bar-border, rgba(0,0,0,0.08))",
          transition: resizeHold && !isDragging ? "left 150ms ease-out, width 150ms ease-out" : undefined,
          zIndex: isDragging || resizeHold ? 10 : undefined,
          ...styleProp,
        }}
        data-task-id={task.id}
        data-task-new={task.id.startsWith("__optimistic_") ? "" : undefined}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu?.(e, task.id)}
        {...rest}
      >
        {/* Left clipping indicator */}
        {computed.clippedLeft && (
          <svg className="shrink-0 h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        )}
        {/* Left resize handle */}
        {onResize && !computed.clippedLeft && !task.isLocked && (
          <div
            className="absolute left-0 top-0 w-1.5 h-full cursor-col-resize opacity-0 group-hover/task:opacity-100 transition-opacity rounded-l-sm"
            style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => handleResizeStart(e, "left")}
          />
        )}
        {computed.timeSlot !== "all-day" && (
          <svg className="shrink-0 h-3 w-3 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )}
        {task.parentId && (
          <svg className="shrink-0 h-3 w-3 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
        )}
        {/* For the grid: read `fileCount` (integer computed in SQL) instead
            of `files.length` (the whole array is no longer sent in lists to
            save payload). Falls back to `files.length` when the data
            comes from an endpoint that still returns the array (e.g. getTaskById). */}
        {showFileIcon !== false && (((task as { fileCount?: number }).fileCount ?? task.files?.length ?? 0) > 0) && (
          <svg className="shrink-0 h-3 w-3 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        )}
        {task.hasConflict && (
          <svg
            className="shrink-0 h-3.5 w-3.5 animate-pulse"
            viewBox="0 0 24 24"
            fill="#f59e0b"
            style={{ filter: "drop-shadow(0 0 2px rgba(245,158,11,0.8))" }}
          >
            <path d="M12 2L1 21h22L12 2zm-1 9v4h2v-4h-2zm0 6v2h2v-2h-2z" />
          </svg>
        )}
        {task.isLocked && (
          <svg className="shrink-0 h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        <span
          className="truncate min-w-0 flex-1"
          style={{
            ...textStyle,
            // Fallback: single color for non half-day bars
            // (labelGradientStyle is `{}` in that case and will not override
            // this property).
            color: taskBarLabelFallbackColor(computed.bgColor, computed.timeSlot),
            ...labelGradientStyle,
          }}
        >{label}</span>
        {task.vehicleNames && task.vehicleNames.length > 0 && (
          <svg
            className="shrink-0 h-3 w-3 opacity-80"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
            <path d="M15 18H9" />
            <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14v10" />
            <circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
          </svg>
        )}
        {task.resourceNames && task.resourceNames.length > 0 && (
          <svg
            className="shrink-0 h-3 w-3 opacity-80"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        )}
        {showUserCount && userCount > 1 && (
          <svg className="shrink-0 h-3 w-3 opacity-75" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="7" r="3.5" />
            <path d="M9 12c-4 0-7 2-7 4.5V18h14v-1.5c0-2.5-3-4.5-7-4.5z" />
            <circle cx="17.5" cy="8" r="2.5" />
            <path d="M22 17v-1c0-1.8-1.8-3.3-4.5-3.8.9.8 1.5 1.8 1.5 3.3V17h3z" />
          </svg>
        )}
        {/* Right clipping indicator */}
        {computed.clippedRight && (
          <svg className="shrink-0 h-3 w-3 opacity-80 ml-auto" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M9 5l7 7-7 7" />
          </svg>
        )}
        {/* Right resize handle */}
        {onResize && !computed.clippedRight && !task.isLocked && (
          <div
            className="absolute right-0 top-0 w-1.5 h-full cursor-col-resize opacity-0 group-hover/task:opacity-100 transition-opacity rounded-r-sm"
            style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => handleResizeStart(e, "right")}
          />
        )}
      </div>
    );
  }
);
