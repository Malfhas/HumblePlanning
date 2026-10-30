/** Thickness of the scrollbars drawn over the grid (days and hours views). */
export const SCROLLBAR_SIZE = 18;

/** Space reserved after the content when a scrollbar covers it: its thickness plus a little air. */
const SCROLLBAR_GUTTER = SCROLLBAR_SIZE + 6;

/**
 * Maximum grid scroll. The scrollbars are overlaid on the edge of the
 * grid: without a reserve, the last row stays hidden under the
 * horizontal bar and the last column under the vertical bar. On touch
 * screens no bar is drawn (`overlay` false): nothing is reserved.
 */
export function gridScrollBounds(
  contentW: number,
  contentH: number,
  viewportW: number,
  viewportH: number,
  overlay: boolean,
): { maxX: number; maxY: number; showH: boolean; showV: boolean } {
  // Grid not measured yet (first render) or empty: nothing to scroll
  if (viewportW <= 0 || viewportH <= 0 || contentW <= 0 || contentH <= 0) {
    return { maxX: 0, maxY: 0, showH: false, showV: false };
  }
  const gutter = overlay ? SCROLLBAR_GUTTER : 0;
  let showH = contentW > viewportW;
  const computeMaxY = () => Math.max(0, contentH + (showH ? gutter : 0) - viewportH);
  let maxY = computeMaxY();
  const maxX = Math.max(0, contentW + (maxY > 0 ? gutter : 0) - viewportW);
  // The vertical bar alone can make the grid horizontally scrollable:
  // the horizontal bar then appears, and the last row must account for it too
  if (!showH && maxX > 0) {
    showH = true;
    maxY = computeMaxY();
  }
  return { maxX, maxY, showH, showV: maxY > 0 };
}

/**
 * Length of a scrollbar thumb: the visible share of the grid, reserve
 * included (`max` comes from `gridScrollBounds`). Never divides by zero.
 */
export function scrollThumbLength(viewport: number, max: number, track: number, minThumb: number): number {
  if (max <= 0 || viewport <= 0) return 0;
  return Math.min(track, Math.max(minThumb, Math.floor((viewport / (viewport + max)) * track)));
}
