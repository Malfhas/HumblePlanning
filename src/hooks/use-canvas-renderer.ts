"use client";

import { useEffect, useRef, useState } from "react";

import { CanvasRenderer } from "@/lib/canvas/renderer";
import type {
  CanvasViewport,
  CanvasRenderData,
  CanvasDragState,
  CanvasHitTarget,
} from "@/lib/canvas/types";

interface UseCanvasRendererOptions {
  /** DOM node of the static canvas (passed directly, not through a ref).
   *  Pattern: `useState<HTMLCanvasElement | null>` + ref callback. It is
   *  the only way to get a useEffect that actually fires when the
   *  canvas is attached (`useRef` changes do not trigger effects). */
  staticCanvas: HTMLCanvasElement | null;
  interactiveCanvas: HTMLCanvasElement | null;
  /** Mutable ref read by the renderer during the rAF loop. */
  dragStateRef: { current: CanvasDragState };
  /** Mutable ref of the hovered taskId (for the hover visual). */
  hoveredTaskIdRef: { current: string | null };
  /** Mutable ref of the hovered cell (hover overlay). */
  hoveredCellRef?: { current: { rowId: string; dateStr: string } | null };
  viewport: CanvasViewport | null;
  data: CanvasRenderData | null;
}

interface UseCanvasRendererReturn {
  /** Pixel hit-test on the canvas (viewport CSS pixel coords). */
  hitTest: (x: number, y: number) => CanvasHitTarget;
  /** Requests a redraw of the static layer on the next rAF tick. */
  requestStaticRedraw: () => void;
  /** Total height of the scrollable content. */
  getTotalContentHeight: () => number;
  /** IDs of the currently visible tasks (for the a11y DOM mirror). */
  getVisibleTaskIds: () => string[];
  /** Current pixel position of a bar (useful to capture fromX/Y
   *  before a drop or a resize, to start an animation). */
  getTaskRect: (taskId: string) => { x: number; y: number; width: number; height: number } | null;
  /** Prospective pixel position of a bar in a target row with
   *  new dates (future toRect of a move, without waiting for the
   *  mutation to propagate). */
  getProspectiveTaskRect: (
    targetRowId: string,
    excludeTaskId: string,
    newStartDate: string,
    newEndDate: string
  ) => { x: number; y: number; width: number; height: number } | null;
  /** "drop" anim: the bar slides from (fromX,fromY) to its current
   *  position in the cache (220 ms easeOutExpo). */
  startMoveAnimation: (taskId: string, fromX: number, fromY: number, toX: number, toY: number) => void;
  /** "resize" anim: the bar goes from fromWidth to toWidth (and fromX
   *  to toX if edge=left), 180 ms easeOutCubic. */
  startResizeAnimation: (taskId: string, fromX: number, fromWidth: number, toX: number, toWidth: number) => void;
  /** "appear" anim: opacity 0→1, scaleX 0.92→1, easeOutBack (200 ms). */
  startAppearAnimation: (taskId: string) => void;
  /** "delete" anim: opacity 1→0, scaleX 1→0.92, 160 ms. */
  startDeleteAnimation: (taskId: string) => void;
  /** Cancels an animation (rollback). */
  cancelTaskAnimation: (taskId: string) => void;
  /** Shows a semi-transparent ghost while the DropActionMenu is
   *  open. The component must call it with the info at drop time
   *  (pre-mutation), then with `null` once the choice is made. */
  setPendingDropPreview: (info: {
    taskId: string;
    targetRowId: string;
    newStartDate: string;
    newEndDate: string;
  } | null) => void;
}

/**
 * Orchestrator hook for the Canvas rendering engine.
 *
 * Wraps the lifecycle of the `CanvasRenderer` instance (creation,
 * cleanup), pushes `viewport` and `data` changes to the renderer,
 * and exposes a minimal API to the React component.
 *
 * The rAF loop runs while the component is mounted. On unmount,
 * `dispose()` releases all resources.
 */
export function useCanvasRenderer({
  staticCanvas,
  interactiveCanvas,
  dragStateRef,
  hoveredTaskIdRef,
  hoveredCellRef,
  viewport,
  data,
}: UseCanvasRendererOptions): UseCanvasRendererReturn {
  const rendererRef = useRef<CanvasRenderer | null>(null);
  /** `rendererReady` state: switches to `true` once the instance is created.
   *  Used as a dependency of the viewport/data push useEffects, so
   *  they fire again when the renderer becomes available
   *  (otherwise they fire once with rendererRef.current === null
   *  and never fire again). */
  const [rendererReady, setRendererReady] = useState(false);

  // ──────────────────────────────────────────────────────────────────
  // Instance creation — triggered by a useEffect with the canvas
  // nodes as deps. When the ref callbacks attach the canvases and
  // call setStaticCanvas(node), the useEffect re-runs and creates the
  // renderer. Reliable pattern with React 19 + StrictMode.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!staticCanvas || !interactiveCanvas) return;

    const renderer = new CanvasRenderer({
      staticCanvas,
      interactiveCanvas,
      dragStateRef,
      hoveredTaskIdRef,
      hoveredCellRef,
    });
    rendererRef.current = renderer;
    renderer.start();
    setRendererReady(true);

    return () => {
      renderer.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, [staticCanvas, interactiveCanvas, dragStateRef, hoveredTaskIdRef, hoveredCellRef]);

  // ──────────────────────────────────────────────────────────────────
  // Push viewport changes — `rendererReady` dep so the push fires
  // as soon as the renderer becomes available.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rendererRef.current || !viewport) return;
    rendererRef.current.setViewport(viewport);
  }, [viewport, rendererReady]);

  // ──────────────────────────────────────────────────────────────────
  // Push data changes — same.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rendererRef.current || !data) return;
    rendererRef.current.setData(data);
  }, [data, rendererReady]);

  return {
    hitTest: (x, y) => rendererRef.current?.hitTest(x, y) ?? { kind: "none" },
    requestStaticRedraw: () => rendererRef.current?.markStaticDirty(),
    getTotalContentHeight: () => rendererRef.current?.getTotalContentHeight() ?? 0,
    getVisibleTaskIds: () => rendererRef.current?.getVisibleTaskIds() ?? [],
    getTaskRect: (taskId) => rendererRef.current?.getTaskRect(taskId) ?? null,
    getProspectiveTaskRect: (targetRowId, excludeTaskId, newStartDate, newEndDate) =>
      rendererRef.current?.getProspectiveTaskRect(targetRowId, excludeTaskId, newStartDate, newEndDate) ?? null,
    startMoveAnimation: (taskId, fromX, fromY, toX, toY) =>
      rendererRef.current?.startMoveAnimation(taskId, fromX, fromY, toX, toY),
    startResizeAnimation: (taskId, fromX, fromWidth, toX, toWidth) =>
      rendererRef.current?.startResizeAnimation(taskId, fromX, fromWidth, toX, toWidth),
    startAppearAnimation: (taskId) => rendererRef.current?.startAppearAnimation(taskId),
    startDeleteAnimation: (taskId) => rendererRef.current?.startDeleteAnimation(taskId),
    cancelTaskAnimation: (taskId) => rendererRef.current?.cancelTaskAnimation(taskId),
    setPendingDropPreview: (info) => rendererRef.current?.setPendingDropPreview(info),
  };
}
