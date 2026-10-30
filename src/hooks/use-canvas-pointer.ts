"use client";

import { useEffect, useRef } from "react";

import type {
  CanvasDragState,
  CanvasHitTarget,
  CanvasViewport,
} from "@/lib/canvas/types";
import { CANVAS_GEOMETRY } from "@/lib/canvas/theme";
import { INITIAL_DRAG_STATE } from "@/lib/canvas/types";

interface UseCanvasPointerOptions {
  /** Interactive canvas passed directly (state + ref callback in the
   *  component). Pattern required by React 19 + StrictMode so that the
   *  useEffects re-fire when the DOM is attached. */
  canvasNode: HTMLCanvasElement | null;
  /** Scrollable container passed directly. */
  containerNode: HTMLDivElement | null;
  /** Current viewport (to compute relative coords). */
  viewport: CanvasViewport | null;
  /** Renderer hit-test. */
  hitTest: (x: number, y: number) => CanvasHitTarget;
  /** Mutable drag state: modified during the drag, read by the renderer. */
  dragStateRef: { current: CanvasDragState };
  /** Mirror sync of `dragStateRef.current.active`: read by the tooltip
   *  hook to hide the tooltips of hovered tasks during
   *  a drag/resize. */
  isDragActiveRef: { current: boolean };
  /** Mutable hovered taskId: used for the visual hover and the tooltip. */
  hoveredTaskIdRef: { current: string | null };
  /** Mutable hovered cell: used for the bg-primary/10 overlay. */
  hoveredCellRef?: { current: { rowId: string; dateStr: string } | null };
  /** Request a redraw of the static layer (after a drag mutation). */
  requestStaticRedraw: () => void;

  // UI callbacks ───────────────────────────────────────────────────
  /** Wheel scroll: returns the new clamped scrollX/Y. */
  onScroll: (deltaX: number, deltaY: number) => void;
  /** Click on a bar. */
  onTaskClick: (taskId: string, rowId: string) => void;
  /** Click on an empty cell. */
  onCellClick: (rowId: string, dateStr: string) => void;
  /** Right-click on a bar. */
  onTaskContextMenu: (taskId: string, rowId: string, x: number, y: number) => void;
  /** Right-click on a cell. */
  onCellContextMenu: (rowId: string, dateStr: string, x: number, y: number) => void;
  /** Drag finished (drop validated). */
  onDragComplete: (info: {
    taskId: string;
    sourceRowId: string;
    targetRowId: string;
    deltaDays: number;
    /** Index of the day clicked at pointerdown (cell under the cursor).
     *  Lets the caller compute a newStartDate anchored on the
     *  cursor if the task is truncated on the left. */
    clickedDayIdx: number;
    dropX: number;
    dropY: number;
  }) => void;
  /** Resize finished. */
  onResizeComplete: (info: {
    taskId: string;
    edge: "left" | "right";
    deltaDays: number;
  }) => void;
  /** Pointerdown interceptor. If it returns `true`, the hook consumes
   *  the event and triggers no canvas action (drag/click). Used
   *  notably to close the context menu on the first click without
   *  triggering the underlying action (task creation, selection…). */
  onPointerDownIntercept?: () => boolean;
  /** Drag gate: if it returns `false`, the task drag is not activated
   *  (no `pointer.activated = true`). Allows the simple click
   *  (opening the edit modal) if the user has the right, but blocks
   *  the drag for `readonly` roles or a locked task. */
  canDragTaskById?: (taskId: string) => boolean;
  /** Resize gate: same but for the left/right edges of the bar. */
  canResizeTaskById?: (taskId: string) => boolean;
}

/**
 * Hook that handles all native pointer events on the interactive canvas:
 *  - pointerdown / pointermove / pointerup / pointercancel
 *  - setPointerCapture to keep the drag even outside the canvas
 *  - 8 px activation distance (parity with @dnd-kit)
 *  - rAF throttle for hovers
 *  - wheel events for horizontal/vertical scroll
 *  - click / context-menu detected at pointerup if there was no drag
 *
 * The pure drag is done by mutating `dragStateRef.current` directly,
 * without React `setState` → 60 fps guaranteed during the drag.
 */
export function useCanvasPointer({
  canvasNode,
  containerNode,
  viewport,
  hitTest,
  dragStateRef,
  isDragActiveRef,
  hoveredTaskIdRef,
  hoveredCellRef,
  requestStaticRedraw,
  onScroll,
  onTaskClick,
  onCellClick,
  onTaskContextMenu,
  onCellContextMenu,
  onDragComplete,
  onResizeComplete,
  onPointerDownIntercept,
  canDragTaskById,
  canResizeTaskById,
}: UseCanvasPointerOptions): void {
  // Refs for the callbacks and the viewport (avoids recreating the handlers)
  const callbacksRef = useRef({
    onScroll,
    onTaskClick,
    onCellClick,
    onTaskContextMenu,
    onCellContextMenu,
    onDragComplete,
    onResizeComplete,
    requestStaticRedraw,
    hitTest,
    onPointerDownIntercept,
    canDragTaskById,
    canResizeTaskById,
  });
  callbacksRef.current = {
    onScroll,
    onTaskClick,
    onCellClick,
    onTaskContextMenu,
    onCellContextMenu,
    onDragComplete,
    onResizeComplete,
    requestStaticRedraw,
    hitTest,
    onPointerDownIntercept,
    canDragTaskById,
    canResizeTaskById,
  };
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // ──────────────────────────────────────────────────────────────────
  // Pointer events
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasNode;
    if (!canvas) return;

    /** Local pointer state (distinct from dragState, pre-activation tracking). */
    const pointer = {
      down: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      // Grid scroll at pointerdown: used to compensate for
      // auto-scroll / the mouse wheel during a drag, so that the target
      // cell stays under the cursor whatever scrolling is applied.
      startScrollX: 0,
      startScrollY: 0,
      activated: false, // true when distance > 8 px
      hitTarget: null as CanvasHitTarget | null,
      isContextMenu: false,
      // Touch pan (mobile / trackpad without wheel): if the pointer touches
      // a cell (not a task) and moves → scroll the grid.
      panActive: false,
      lastX: 0,
      lastY: 0,
      pointerType: "mouse" as string,
    };

    const getCanvasCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    /** Edge auto-scroll during a drag: rAF loop that scrolls
     *  continuously while the mouse stays within 40 px of an edge,
     *  even if the mouse does not move. Stops as soon as the mouse leaves
     *  the zone or the drag ends. */
    let autoScrollRaf: number | null = null;
    const stopAutoScroll = () => {
      if (autoScrollRaf !== null) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
    };
    const tickAutoScroll = () => {
      autoScrollRaf = null;
      const drag = dragStateRef.current;
      const v = viewportRef.current;
      if (!drag.active || !v) return;
      const { x, y } = getCanvasCoords(drag.pointerX, drag.pointerY);
      const EDGE = 40;
      const SPEED = 12;
      let dx = 0;
      let dy = 0;
      if (x < v.sidebarWidth + EDGE) dx = -SPEED;
      else if (x > v.width - EDGE) dx = SPEED;
      if (y < v.headerHeight + EDGE) dy = -SPEED;
      else if (y > v.height - EDGE) dy = SPEED;
      if (dx === 0 && dy === 0) return; // out of zone → end of the loop
      callbacksRef.current.onScroll(dx, dy);
      autoScrollRaf = requestAnimationFrame(tickAutoScroll);
    };
    const ensureAutoScrollLoop = () => {
      if (autoScrollRaf === null) autoScrollRaf = requestAnimationFrame(tickAutoScroll);
    };

    const updateCursor = (target: CanvasHitTarget) => {
      switch (target.kind) {
        case "task":
          canvas.style.cursor =
            target.subzone === "resize-left" || target.subzone === "resize-right"
              ? "ew-resize"
              : "pointer";
          break;
        case "cell":
          // Clickable empty cell (task creation) → pointer like on a task
          canvas.style.cursor = "pointer";
          break;
        case "header":
        case "sidebar":
          canvas.style.cursor = "default";
          break;
        default:
          canvas.style.cursor = "default";
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      // If a context menu is open, the first click closes it and
      // triggers no canvas action (legacy parity: double click
      // required to open a new modal).
      if (callbacksRef.current.onPointerDownIntercept?.()) {
        e.preventDefault();
        return;
      }
      // Right-click / middle-click → context menu only, no drag
      pointer.isContextMenu = e.button === 2;
      if (e.button !== 0 && e.button !== 2) return;

      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      const target = callbacksRef.current.hitTest(x, y);
      pointer.down = true;
      pointer.pointerId = e.pointerId;
      pointer.startX = e.clientX;
      pointer.startY = e.clientY;
      pointer.startScrollX = viewportRef.current?.scrollX ?? 0;
      pointer.startScrollY = viewportRef.current?.scrollY ?? 0;
      pointer.lastX = e.clientX;
      pointer.lastY = e.clientY;
      pointer.activated = false;
      pointer.hitTarget = target;
      pointer.panActive = false;
      pointer.pointerType = e.pointerType || "mouse";

      if (e.button === 0 && target.kind === "task") {
        // Capture the pointer immediately so that pointermove keeps tracking
        // outside the canvas if needed.
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const { x, y } = getCanvasCoords(e.clientX, e.clientY);

      if (!pointer.down) {
        // Hover outside a drag: update hovered taskId + cell
        const target = callbacksRef.current.hitTest(x, y);
        const newHovered =
          target.kind === "task" ? target.taskId : null;
        if (hoveredTaskIdRef.current !== newHovered) {
          hoveredTaskIdRef.current = newHovered;
          callbacksRef.current.requestStaticRedraw();
        }
        // Hovered cell (bg-primary/10 overlay on the cell). The
        // overlay is painted in the static layer (behind the bars) →
        // redraw the static layer when the cell changes.
        if (hoveredCellRef) {
          const newCell =
            target.kind === "cell"
              ? { rowId: target.rowId, dateStr: target.dateStr }
              : null;
          const cur = hoveredCellRef.current;
          const changed =
            (cur === null) !== (newCell === null) ||
            !!(cur && newCell && (cur.rowId !== newCell.rowId || cur.dateStr !== newCell.dateStr));
          if (changed) {
            hoveredCellRef.current = newCell;
            callbacksRef.current.requestStaticRedraw();
          }
        }
        updateCursor(target);
        return;
      }

      // Pointer down: check whether the activation distance is exceeded
      const dx = e.clientX - pointer.startX;
      const dy = e.clientY - pointer.startY;
      const distSq = dx * dx + dy * dy;

      // Touch pan (mobile): any finger swipe scrolls the grid, whatever
      // the target (cell, task, none). Since task drag is
      // disabled on mobile (canDragTaskById → false), there is no
      // conflict here. A simple tap (no movement > 8 px) remains
      // a standard click that opens the modal.
      if (!pointer.activated && pointer.pointerType === "touch") {
        if (distSq < CANVAS_GEOMETRY.dragActivationDistance ** 2) return;
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
        callbacksRef.current.onScroll(-ddx, -ddy);
        return;
      }

      if (!pointer.activated) {
        if (distSq < CANVAS_GEOMETRY.dragActivationDistance ** 2) return;
        // Permission gate BEFORE activation: if the user is not
        // allowed to drag/resize this task, do not activate the drag.
        // The simple click (which opens the modal) remains possible if the
        // `canModifyTask` permission is OK (gating done in the menu /
        // handler in the component).
        if (pointer.hitTarget?.kind === "task") {
          const t = pointer.hitTarget;
          const isResize = t.subzone === "resize-left" || t.subzone === "resize-right";
          const allow = isResize
            ? callbacksRef.current.canResizeTaskById?.(t.taskId) ?? true
            : callbacksRef.current.canDragTaskById?.(t.taskId) ?? true;
          if (!allow) {
            // Drag refused. Do NOT set pointer.activated → the
            // pointerup falls through to the simple click (opening the
            // edit modal if the user has `canModifyTask`).
            return;
          }
        }
        pointer.activated = true;
        // Activate the global drag state
        if (pointer.hitTarget?.kind === "task") {
          const t = pointer.hitTarget;
          isDragActiveRef.current = true;
          // Compute the index of the clicked day (cell under the mouse at
          // pointerdown). Lets the drag preview anchor the start of the
          // bar on the cursor when the source task is truncated.
          const v = viewportRef.current;
          const clickedDayIdx = v
            ? Math.floor((pointer.startX - v.sidebarWidth + v.scrollX) / v.cellWidth)
            : 0;
          dragStateRef.current = {
            active: true,
            taskId: t.taskId,
            mode:
              t.subzone === "resize-left"
                ? "resize-left"
                : t.subzone === "resize-right"
                ? "resize-right"
                : "move",
            originX: pointer.startX,
            originY: pointer.startY,
            deltaDays: 0,
            targetRowId: t.rowId,
            pointerX: e.clientX,
            pointerY: e.clientY,
            clickedDayIdx,
          };
          // Force a static redraw to hide the source bar (the preview
          // is now drawn in its place on the interactive layer).
          callbacksRef.current.requestStaticRedraw();
        }
      }

      // During the drag: update the coords and the day delta.
      // `handleScroll` in the component already adjusts `drag.originX` on each
      // auto-scroll call so that `dx` automatically reflects the
      // applied scrolling; no need to accumulate the scroll here, otherwise
      // double counting and bar/target cell desync.
      const v = viewportRef.current;
      const drag = dragStateRef.current;
      if (drag.active && v) {
        const dxFromOrigin = e.clientX - drag.originX;
        const newDeltaDays = Math.round(dxFromOrigin / v.cellWidth);
        // Find the target cell under the cursor (for a row change)
        const target = callbacksRef.current.hitTest(x, y);
        if (target.kind === "cell" || target.kind === "task") {
          drag.targetRowId = target.kind === "cell" ? target.rowId : target.rowId;
        }
        drag.deltaDays = newDeltaDays;
        drag.pointerX = e.clientX;
        drag.pointerY = e.clientY;

        // Edge auto-scroll: start the rAF loop if the mouse is
        // near an edge. The loop keeps scrolling while the mouse
        // stays in the zone, even still, and stops as soon as it
        // leaves; much more stable than scrolling on pointermove.
        ensureAutoScrollLoop();
        // No setState → the rAF loop redraws the interactive layer
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      // Stop the auto-scroll loop at pointerup, regardless of
      // the path (drag, pan, simple click).
      stopAutoScroll();

      if (!pointer.down) return;
      // Touch pan finished: no click/contextMenu, just reset.
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
      pointer.hitTarget = null;

      // Right-click → context menu (never a drag)
      if (pointer.isContextMenu && target) {
        if (target.kind === "task") {
          callbacksRef.current.onTaskContextMenu(target.taskId, target.rowId, e.clientX, e.clientY);
        } else if (target.kind === "cell") {
          callbacksRef.current.onCellContextMenu(target.rowId, target.dateStr, e.clientX, e.clientY);
        }
        pointer.isContextMenu = false;
        return;
      }

      const drag = dragStateRef.current;

      if (wasActivated && drag.active && drag.taskId) {
        // Drag completed
        const sourceRowId = target?.kind === "task" ? target.rowId : "";
        const targetRowId = drag.targetRowId ?? sourceRowId;
        if (drag.mode === "move") {
          callbacksRef.current.onDragComplete({
            taskId: drag.taskId,
            sourceRowId,
            targetRowId,
            deltaDays: drag.deltaDays,
            clickedDayIdx: drag.clickedDayIdx,
            dropX: e.clientX,
            dropY: e.clientY,
          });
        } else if (drag.mode === "resize-left" || drag.mode === "resize-right") {
          callbacksRef.current.onResizeComplete({
            taskId: drag.taskId,
            edge: drag.mode === "resize-left" ? "left" : "right",
            deltaDays: drag.deltaDays,
          });
        }
        // Hold preview ~150 ms: gives the react-query cache optimistic update
        // time to propagate the new position to the static layer
        // before hiding the preview. Avoids flicker (empty frame
        // between the preview disappearing and the new bar appearing).
        setTimeout(() => {
          isDragActiveRef.current = false;
          dragStateRef.current = { ...INITIAL_DRAG_STATE };
          callbacksRef.current.requestStaticRedraw();
        }, 150);
        return;
      } else if (target) {
        // Simple click (not activated)
        if (target.kind === "task") {
          callbacksRef.current.onTaskClick(target.taskId, target.rowId);
        } else if (target.kind === "cell") {
          callbacksRef.current.onCellClick(target.rowId, target.dateStr);
        }
      }

      // Immediate reset (simple click case, no drag activated)
      isDragActiveRef.current = false;
      dragStateRef.current = { ...INITIAL_DRAG_STATE };
      callbacksRef.current.requestStaticRedraw();
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      pointer.down = false;
      pointer.activated = false;
      pointer.hitTarget = null;
      isDragActiveRef.current = false;
      dragStateRef.current = { ...INITIAL_DRAG_STATE };
      callbacksRef.current.requestStaticRedraw();
    };

    const handleContextMenu = (e: MouseEvent) => {
      // Right-click is handled via pointerdown/up: prevent the browser's
      // native context menu.
      e.preventDefault();
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      stopAutoScroll();
    };
  }, [canvasNode, dragStateRef, hoveredTaskIdRef]);

  // ──────────────────────────────────────────────────────────────────
  // Wheel events (vertical/horizontal scroll)
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerNode;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Shift + wheel = horizontal scroll (standard browser parity)
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      callbacksRef.current.onScroll(dx, dy);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [containerNode]);
}
