"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { CanvasHitTarget } from "@/lib/canvas/types";

interface UseCanvasTooltipOptions {
  /** Interactive canvas (state + ref callback). */
  canvasNode: HTMLCanvasElement | null;
  /** Container (state + ref callback). */
  containerNode: HTMLDivElement | null;
  /** Renderer hit-test. */
  hitTest: (x: number, y: number) => CanvasHitTarget;
  /** Ref of the 1×1 px ghost div (positioned by direct DOM mutation). */
  anchorRef: RefObject<HTMLDivElement | null>;
  /** When a drag is active, the tooltip is hidden. */
  isDragActiveRef: { current: boolean };
  /** When true, hides the tooltips and prevents new ones from
   *  showing (used while dragging a canvas scrollbar). */
  disabled?: boolean;
}

/**
 * Returned state: currently hovered taskId + tooltip anchor in screen
 * coords (clientX/Y) for the `controlled` mode of the TaskTooltip component.
 */
interface UseCanvasTooltipReturn {
  hoveredTaskId: string | null;
  /** rowId of the hovered sidebar row (for the user tooltip). */
  hoveredSidebarRowId: string | null;
  /** Anchor in screen coords (clientX/Y) — for TaskTooltip controlled mode. */
  tooltipAnchor: { x: number; top: number; bottom: number };
  /** Forces the current tooltip to close — used when the mouse enters
   *  an area that is no longer the canvas (e.g. overlay scrollbars
   *  where the canvas `pointermove` no longer fires). */
  clearTooltip: () => void;
}

/**
 * Hook that manages the Radix tooltip on canvas bars ("Piste 1" pattern).
 *
 * Critical performance strategy:
 *  1. The `anchorRef` ghost div is positioned through direct DOM
 *     mutation (`style.transform = translate(...)`) on every pointermove
 *     in the canvas. **NO setState** on every pixel.
 *  2. `setState(taskId)` is called ONLY when the hovered taskId
 *     changes. That triggers the React re-render and opens the
 *     controlled Radix `<Tooltip>`.
 *  3. `TaskTooltip` (Radix) receives the taskId once, with no re-render
 *     as long as the hovered task does not change.
 *
 * Disabled during a drag (`isDragActiveRef.current === true`).
 */
export function useCanvasTooltip({
  canvasNode,
  containerNode,
  hitTest,
  anchorRef,
  isDragActiveRef,
  disabled = false,
}: UseCanvasTooltipOptions): UseCanvasTooltipReturn {
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [hoveredSidebarRowId, setHoveredSidebarRowId] = useState<string | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ x: number; top: number; bottom: number }>(
    { x: 0, top: 0, bottom: 0 }
  );
  const lastTaskIdRef = useRef<string | null>(null);
  const lastSidebarIdRef = useRef<string | null>(null);
  const hitTestRef = useRef(hitTest);
  hitTestRef.current = hitTest;

  useEffect(() => {
    const canvas = canvasNode;
    const anchor = anchorRef.current;
    const container = containerNode;
    if (!canvas || !anchor || !container) return;

    const positionAnchor = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      anchor.style.transform = `translate(${x}px, ${y}px)`;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isDragActiveRef.current || disabled) {
        // During a drag, hide all tooltips
        if (lastTaskIdRef.current !== null) {
          lastTaskIdRef.current = null;
          setHoveredTaskId(null);
        }
        if (lastSidebarIdRef.current !== null) {
          lastSidebarIdRef.current = null;
          setHoveredSidebarRowId(null);
        }
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const target = hitTestRef.current(x, y);

      if (target.kind === "task") {
        positionAnchor(e.clientX, e.clientY);
        // On the resize edges (6 px) the legacy grid hides the tooltip so
        // the handles show. Exact parity.
        if (target.subzone === "resize-left" || target.subzone === "resize-right") {
          if (lastTaskIdRef.current !== null) {
            lastTaskIdRef.current = null;
            setHoveredTaskId(null);
          }
          return;
        }
        // Anchor: x follows the cursor, top/bottom anchored to the BAR (legacy parity).
        const newAnchor = {
          x: e.clientX,
          top: rect.top + target.barTop,
          bottom: rect.top + target.barBottom,
        };
        if (lastTaskIdRef.current !== target.taskId) {
          lastTaskIdRef.current = target.taskId;
          setHoveredTaskId(target.taskId);
        }
        // Update on EVERY move (horizontal cursor tracking)
        setTooltipAnchor(newAnchor);
        if (lastSidebarIdRef.current !== null) {
          lastSidebarIdRef.current = null;
          setHoveredSidebarRowId(null);
        }
      } else if (target.kind === "sidebar" || target.kind === "group-header") {
        // Sidebar / group banner: tooltip anchored to the right of the sidebar,
        // centered on the row. The component picks the right Tooltip (UserTooltip,
        // ProjectTooltip, VehicleTooltip or GroupHeaderTooltip for the
        // banners) based on row.type.
        const newAnchor = {
          x: rect.left + 0,
          top: rect.top + target.rowTop,
          bottom: rect.top + target.rowBottom,
        };
        if (lastSidebarIdRef.current !== target.rowId) {
          lastSidebarIdRef.current = target.rowId;
          setHoveredSidebarRowId(target.rowId);
        }
        setTooltipAnchor(newAnchor);
        if (lastTaskIdRef.current !== null) {
          lastTaskIdRef.current = null;
          setHoveredTaskId(null);
        }
      } else {
        if (lastTaskIdRef.current !== null) {
          lastTaskIdRef.current = null;
          setHoveredTaskId(null);
        }
        if (lastSidebarIdRef.current !== null) {
          lastSidebarIdRef.current = null;
          setHoveredSidebarRowId(null);
        }
      }
    };

    const handlePointerLeave = () => {
      if (lastTaskIdRef.current !== null) {
        lastTaskIdRef.current = null;
        setHoveredTaskId(null);
      }
      if (lastSidebarIdRef.current !== null) {
        lastSidebarIdRef.current = null;
        setHoveredSidebarRowId(null);
      }
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [canvasNode, containerNode, anchorRef, isDragActiveRef, disabled]);

  // Immediately clear the tooltips when `disabled` becomes true (scroll start).
  useEffect(() => {
    if (!disabled) return;
    if (lastTaskIdRef.current !== null) {
      lastTaskIdRef.current = null;
      setHoveredTaskId(null);
    }
    if (lastSidebarIdRef.current !== null) {
      lastSidebarIdRef.current = null;
      setHoveredSidebarRowId(null);
    }
  }, [disabled]);

  const clearTooltip = useCallback(() => {
    if (lastTaskIdRef.current !== null) {
      lastTaskIdRef.current = null;
      setHoveredTaskId(null);
    }
    if (lastSidebarIdRef.current !== null) {
      lastSidebarIdRef.current = null;
      setHoveredSidebarRowId(null);
    }
  }, []);

  return { hoveredTaskId, hoveredSidebarRowId, tooltipAnchor, clearTooltip };
}
