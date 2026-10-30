"use client";

import { useCallback, useEffect, useState } from "react";

interface UseCanvasA11yOptions {
  /** IDs of the tasks in the current viewport (from the renderer). */
  visibleTaskIds: string[];
  /** Callback: activate (open for editing) a task from the keyboard. */
  onActivate: (taskId: string) => void;
}

interface UseCanvasA11yReturn {
  focusedTaskId: string | null;
  setFocusedTaskId: (id: string | null) => void;
  /** ARIA live announcements (drop/resize/delete mutations). */
  liveMessage: string | null;
  announce: (msg: string) => void;
}

/**
 * Canvas a11y hook: keeps the keyboard focus state on a task, handles
 * shortcuts (arrows, Enter, Escape), and exposes an `announce` function
 * for ARIA live announcements ("Task moved to
 * May 12").
 *
 * The DOM mirror (`<CanvasA11yMirror>`) consumes `focusedTaskId` for
 * roving tabindex and `liveMessage` for the polite aria-live region.
 */
export function useCanvasA11y({
  visibleTaskIds,
  onActivate,
}: UseCanvasA11yOptions): UseCanvasA11yReturn {
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);

  // If the focused task is no longer visible, move the focus
  // to the first visible task (or null).
  useEffect(() => {
    if (focusedTaskId && !visibleTaskIds.includes(focusedTaskId)) {
      setFocusedTaskId(visibleTaskIds[0] ?? null);
    }
  }, [focusedTaskId, visibleTaskIds]);

  // Keyboard shortcuts — left/right arrows to navigate between tasks
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore when the target is an input/textarea
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!focusedTaskId) return;

      const idx = visibleTaskIds.indexOf(focusedTaskId);
      if (idx < 0) return;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          setFocusedTaskId(visibleTaskIds[Math.min(idx + 1, visibleTaskIds.length - 1)] ?? null);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          setFocusedTaskId(visibleTaskIds[Math.max(idx - 1, 0)] ?? null);
          break;
        case "Enter":
          e.preventDefault();
          onActivate(focusedTaskId);
          break;
        case "Escape":
          e.preventDefault();
          setFocusedTaskId(null);
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusedTaskId, visibleTaskIds, onActivate]);

  const announce = useCallback((msg: string) => {
    setLiveMessage(msg);
    // Reset after 1.5s so an identical announcement can be made again
    const t = setTimeout(() => setLiveMessage(null), 1500);
    return () => clearTimeout(t);
  }, []);

  return { focusedTaskId, setFocusedTaskId, liveMessage, announce };
}
