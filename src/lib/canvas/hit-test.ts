/**
 * Pixel hit-testing for the canvas.
 *
 * Two-level architecture:
 *  1. O(1) computation of the cell (rowIdx, dayIdx) via Math.floor on the
 *     cursor coordinates — the grid is regular (day × resource).
 *  2. Bucket map `rowId → AllocatedTask[]` to find the exact bar
 *     in the cell (1-3 tasks per bucket in practice).
 *
 * For ~30,000 tasks, the bucket map is built in O(n) (~3 ms) and
 * each hit-test takes < 0.1 ms.
 */

import type { AllocatedTask } from "@/lib/utils/slot-allocator";
import type { CanvasViewport, CanvasHitTarget } from "./types";
import type { GridRow as PlanningGridRow } from "@/lib/utils/sort-rows";
import { CANVAS_GEOMETRY } from "./theme";

/** Map rowId → allocated tasks sorted by startDate (for binary search). */
export type BucketMap = Map<string, AllocatedTask[]>;

/**
 * Builds the bucket map from slotData. Rebuild it when
 * tasks/slotData change (typically after an API mutation).
 */
export function buildBucketMap(
  slotData: Map<string, { tasks: AllocatedTask[]; maxSlot: number; height: number }>
): BucketMap {
  const map: BucketMap = new Map();
  for (const [rowId, { tasks }] of slotData) {
    map.set(rowId, tasks);
  }
  return map;
}

/**
 * Determines the target under the (x, y) coordinates of the canvas viewport.
 *
 * Test priority:
 *   1. Header (y < headerHeight)
 *   2. Sidebar (x < sidebarWidth)
 *   3. Cell + any bar on it
 *
 * For a cell, we check whether a bar is allocated at this position
 * by looking at the `AllocatedTask`s of the row bucket, filtering
 * by `startDate <= dateStr <= endDate` and by `slot`, which sets
 * the y offset within the row.
 */
export function hitTestCanvas(
  x: number,
  y: number,
  viewport: CanvasViewport,
  buckets: BucketMap,
  rowIdToY: Map<string, { y: number; height: number }>,
  daysIso: string[],
  sortedRows: PlanningGridRow[]
): CanvasHitTarget {
  // 1. Header
  if (y < viewport.headerHeight) {
    if (x < viewport.sidebarWidth) {
      return { kind: "none" }; // top-left corner
    }
    const dayIdx = Math.floor((x - viewport.sidebarWidth + viewport.scrollX) / viewport.cellWidth);
    const dateStr = daysIso[dayIdx];
    if (!dateStr) return { kind: "none" };
    return { kind: "header", dateStr };
  }

  // 2. Sidebar — find the row under the cursor
  if (x < viewport.sidebarWidth) {
    const rowId = findRowAtY(y, viewport, rowIdToY);
    if (!rowId) return { kind: "none" };
    const row = sortedRows.find((r) => r.id === rowId);
    if (!row) return { kind: "none" };
    const rowInfo = rowIdToY.get(rowId);
    if (!rowInfo) return { kind: "none" };
    const rowTop = viewport.headerHeight + rowInfo.y - viewport.scrollY;
    const rowBottom = rowTop + rowInfo.height;
    // Group banner → dedicated kind to show the "full name" tooltip.
    if (row.type === "header") {
      return { kind: "group-header", rowId, rowTop, rowBottom };
    }
    return { kind: "sidebar", rowId, rowTop, rowBottom };
  }

  // 3. Grid area — find the row, then the bar
  const rowId = findRowAtY(y, viewport, rowIdToY);
  if (!rowId) return { kind: "none" };
  const row = sortedRows.find((r) => r.id === rowId);
  // Group banner: spans the full width (sidebar + grid) → we also
  // return "group-header" over the grid area so the tooltip
  // shows anywhere on the banner.
  if (row?.type === "header") {
    const rowInfo = rowIdToY.get(rowId);
    if (!rowInfo) return { kind: "none" };
    const rowTop = viewport.headerHeight + rowInfo.y - viewport.scrollY;
    const rowBottom = rowTop + rowInfo.height;
    return { kind: "group-header", rowId, rowTop, rowBottom };
  }
  const dayIdx = Math.floor((x - viewport.sidebarWidth + viewport.scrollX) / viewport.cellWidth);
  if (dayIdx < 0 || dayIdx >= viewport.dayCount) return { kind: "none" };
  const dateStr = daysIso[dayIdx];
  if (!dateStr) return { kind: "none" };

  // Test the bars in this row
  const tasks = buckets.get(rowId);
  if (!tasks) return { kind: "cell", rowId, dateStr };

  // y position RELATIVE to the row (to compute the hovered slot)
  const rowInfo = rowIdToY.get(rowId);
  if (!rowInfo) return { kind: "cell", rowId, dateStr };
  const yInRow = y - (viewport.headerHeight + rowInfo.y - viewport.scrollY);

  // Vertical slot under the cursor
  const slotHeight = CANVAS_GEOMETRY.taskBarHeight + CANVAS_GEOMETRY.taskBarGap;
  const slot = Math.floor((yInRow - CANVAS_GEOMETRY.rowPadding) / slotHeight);

  // Look for a bar allocated to this slot whose date range covers dateStr
  for (const at of tasks) {
    if (at.slot !== slot) continue;
    const taskEnd = at.endDate ?? at.startDate;
    if (at.startDate <= dateStr && taskEnd >= dateStr) {
      // Vertical position of the bar in the row (slot * (h+gap) + padding)
      const rowYTop = viewport.headerHeight + rowInfo.y - viewport.scrollY;
      const barTop =
        rowYTop +
        at.slot * (CANVAS_GEOMETRY.taskBarHeight + CANVAS_GEOMETRY.taskBarGap) +
        CANVAS_GEOMETRY.rowPadding;
      const barBottom = barTop + CANVAS_GEOMETRY.taskBarHeight;
      // Determine the subzone (resize-left / resize-right / body).
      // If the task overflows the visible period, resize is disabled on the
      // truncated side: resizing is impossible without out-of-period context.
      const taskStartIdx = daysIso.indexOf(at.startDate);
      const taskEndIdx = daysIso.indexOf(taskEnd);
      const truncatedLeft = taskStartIdx < 0;
      const truncatedRight = taskEndIdx < 0;
      // If NEITHER the start NOR the end is in daysIso, nothing can be
      // located — the bar is returned as "body" without subzones.
      if (truncatedLeft && truncatedRight) {
        return { kind: "task", taskId: at.id, rowId, subzone: "body", barTop, barBottom };
      }
      // Align the hit-test with the drawn bar: the bar is rendered at
      // `cellLeft + cellBarPaddingX`, so the left handle starts at this
      // offset (same on the right), so the clickable resize area
      // matches the visual handle pixel for pixel.
      const pad = CANVAS_GEOMETRY.cellBarPaddingX;
      // If truncated on one side, the visible edge of the grid is used as
      // reference — the handle on the other side stays clickable as usual.
      const taskLeftPx = truncatedLeft
        ? viewport.sidebarWidth
        : viewport.sidebarWidth + taskStartIdx * viewport.cellWidth - viewport.scrollX + pad;
      const taskRightPx = truncatedRight
        ? viewport.sidebarWidth + daysIso.length * viewport.cellWidth - viewport.scrollX
        : viewport.sidebarWidth + (taskEndIdx + 1) * viewport.cellWidth - viewport.scrollX - pad;
      const handle = CANVAS_GEOMETRY.resizeHandleWidth;
      // Hourly task (with startTime): no resize in the days view — we
      // cannot stretch 1 hour over 1 day without breaking the semantics.
      // Resize stays available in the hours view (other code path).
      // Locked task: no resize zone detected either, so that
      // the cursor stays "pointer" (no misleading "ew-resize").
      // Non-resizable task (`tasks:resize` permission disabled
      // or no edit right): same, no resize zone → no
      // misleading ew-resize cursor (same for vehicle/resource
      // assignments depending on their module perms).
      const isHourly = !!at.startTime;
      const isLocked = !!at.isLocked;
      const canResize = at.canResize !== false;
      let subzone: "body" | "resize-left" | "resize-right" = "body";
      if (!isHourly && !isLocked && canResize) {
        if (!truncatedLeft && x < taskLeftPx + handle) subzone = "resize-left";
        else if (!truncatedRight && x > taskRightPx - handle) subzone = "resize-right";
      }
      return { kind: "task", taskId: at.id, rowId, subzone, barTop, barBottom };
    }
  }

  return { kind: "cell", rowId, dateStr };
}

/** Finds the row id under a Y coordinate (in CSS pixels). */
function findRowAtY(
  y: number,
  viewport: CanvasViewport,
  rowIdToY: Map<string, { y: number; height: number }>
): string | null {
  const yInGrid = y - viewport.headerHeight + viewport.scrollY;
  for (const [rowId, info] of rowIdToY) {
    if (yInGrid >= info.y && yInGrid < info.y + info.height) {
      return rowId;
    }
  }
  return null;
}

/**
 * Builds the `rowId → { y, height }` map from sortedRows + slotData.
 * Caches vertical positions for hit-testing and virtual scrolling.
 */
export function buildRowYMap(
  sortedRows: PlanningGridRow[],
  slotData: Map<string, { tasks: AllocatedTask[]; maxSlot: number; height: number }>
): Map<string, { y: number; height: number }> {
  const map = new Map<string, { y: number; height: number }>();
  let cursor = 0;
  for (const row of sortedRows) {
    let height: number;
    if (row.type === "header") {
      height = CANVAS_GEOMETRY.headerRowHeight;
    } else {
      const slot = slotData.get(row.id);
      if (slot) {
        height = slot.height;
      } else {
        height = CANVAS_GEOMETRY.minRowHeight;
      }
    }
    map.set(row.id, { y: cursor, height });
    cursor += height;
  }
  return map;
}

/** Total height of the scrollable area (all rows combined). */
export function getTotalContentHeight(
  rowIdToY: Map<string, { y: number; height: number }>,
  sortedRows: PlanningGridRow[]
): number {
  if (sortedRows.length === 0) return 0;
  const last = sortedRows[sortedRows.length - 1];
  const info = rowIdToY.get(last.id);
  if (!info) return 0;
  return info.y + info.height;
}
