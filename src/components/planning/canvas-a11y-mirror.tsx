"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import type { TaskWithUsers } from "@/types";
import { useDateFormat } from "@/hooks/use-date-format";

interface CanvasA11yMirrorProps {
  /** IDs of the tasks currently visible in the viewport (from the renderer). */
  visibleTaskIds: string[];
  /** Map taskId → task (for the aria-labels). */
  taskIndex: Map<string, TaskWithUsers>;
  /** ID of the currently focused task (roving tabindex). */
  focusedTaskId: string | null;
  /** Focus callback from the keyboard. */
  setFocusedTaskId: (id: string | null) => void;
  /** Activation callback (Enter or click). */
  onActivate: (taskId: string) => void;
  /** ARIA live message (mutation announcement). */
  liveMessage: string | null;
}

/**
 * Accessible DOM mirror for the canvas grid. Figma / Google Sheets
 * pattern: an invisible `<div role="grid">` for screen readers,
 * synchronized with the canvas.
 *
 * Virtualized: only the tasks in the viewport have a `<button>`
 * in the DOM. Roving tabindex: a single focusable button at a time
 * (`tabIndex={0}` on the focused task, `-1` on the others).
 *
 * The `aria-rowindex` / `aria-colindex` attributes are not computed
 * here (the canvas grid has complex 2D logic with multiple slots
 * per row). However, each button has a rich `aria-label` that
 * is enough for screen reading.
 *
 * A `<div role="status" aria-live="polite">` region announces the
 * mutations (drop, resize, delete) without interrupting the user.
 */
export function CanvasA11yMirror({
  visibleTaskIds,
  taskIndex,
  focusedTaskId,
  setFocusedTaskId,
  onActivate,
  liveMessage,
}: CanvasA11yMirrorProps) {
  const t = useTranslations("planning");
  const { formatDate, formatTime } = useDateFormat();
  const focusedButtonRef = useRef<HTMLButtonElement>(null);

  const buildAriaLabel = (task: TaskWithUsers): string => {
    const parts: string[] = [];
    parts.push(task.title || t("canvas.untitled"));
    if (task.startDate) {
      if (task.endDate && task.endDate !== task.startDate) {
        parts.push(t("a11y.dateRange", { start: formatDate(task.startDate), end: formatDate(task.endDate) }));
      } else {
        parts.push(t("a11y.dateSingle", { date: formatDate(task.startDate) }));
      }
    }
    if (task.startTime) {
      if (task.endTime) parts.push(t("a11y.timeRange", { start: formatTime(task.startTime), end: formatTime(task.endTime) }));
      else parts.push(t("a11y.timeSingle", { time: formatTime(task.startTime) }));
    }
    if (task.project?.name) parts.push(t("a11y.project", { name: task.project.name }));
    if (task.users && task.users.length > 0) {
      const names = task.users.map((u) => u.name).filter(Boolean).join(", ");
      if (names) parts.push(t("a11y.assignedTo", { names }));
    }
    if (task.isLocked) parts.push(t("a11y.locked"));
    return parts.join(", ");
  };

  // Auto-focus the button when focusedTaskId changes (sync
  // with keyboard navigation).
  useEffect(() => {
    if (focusedTaskId && focusedButtonRef.current) {
      focusedButtonRef.current.focus();
    }
  }, [focusedTaskId]);

  return (
    <>
      {/* DOM mirror grid — sr-only style so the visuals are not disturbed */}
      <div
        role="grid"
        aria-rowcount={visibleTaskIds.length}
        aria-label={t("a11y.gridLabel")}
        className="sr-only"
      >
        {visibleTaskIds.map((taskId) => {
          const task = taskIndex.get(taskId);
          if (!task) return null;
          const isFocused = taskId === focusedTaskId;
          return (
            <div role="row" key={taskId}>
              <div role="gridcell">
                <button
                  ref={isFocused ? focusedButtonRef : null}
                  tabIndex={isFocused ? 0 : -1}
                  aria-label={buildAriaLabel(task)}
                  onFocus={() => setFocusedTaskId(taskId)}
                  onClick={() => onActivate(taskId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onActivate(taskId);
                    }
                  }}
                >
                  {task.title || t("canvas.untitled")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ARIA live region — mutation announcements */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </>
  );
}
