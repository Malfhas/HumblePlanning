"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { usePlanningStore } from "@/stores/planning-store";
import type { TimeSlot } from "@/lib/utils/time-slots";

interface HourCellProps {
  slot: TimeSlot;
  slotWidth: number;
  rowId: string;
  dateStr: string;
  onClick?: (rowId: string, dateStr: string, hour: number) => void;
  onContextMenu?: (e: React.MouseEvent, rowId: string, dateStr: string, hour: number) => void;
}

export function HourCell({
  slot,
  slotWidth,
  rowId,
  dateStr,
  onClick,
  onContextMenu,
}: HourCellProps) {
  const cellId = `${rowId}:${dateStr}:${slot.hour}`;

  // Granular Zustand selectors: subscribe to the derived BOOLEAN specific to
  // this cell (not to the raw `dragOverCellId`/`resizePreview`). As a result,
  // Zustand re-renders this cell ONLY when its `isDragOver` /
  // `isResizeTarget` actually changes. Same pattern as `grid-cell.tsx`.
  const isDragOver = usePlanningStore(
    useCallback((s) => s.dragOverCellId === cellId, [cellId])
  );
  const isResizeTarget = usePlanningStore(
    useCallback((s) => {
      const p = s.resizePreview;
      return !!p && p.columnId === rowId && slot.hour >= p.startHour && slot.hour < p.endHour;
    }, [rowId, slot.hour])
  );
  const ganttResizeActive = usePlanningStore((s) => s.ganttResizeActive);

  const isHighlighted = isDragOver || isResizeTarget;

  return (
    <div
      data-cell-id={cellId}
      className={cn(
        "border-r border-b h-full transition-colors duration-100 cursor-pointer shrink-0",
        !ganttResizeActive && "hover:bg-primary/10",
        isHighlighted && "!bg-primary/15"
      )}
      style={{
        width: slotWidth,
        minWidth: slotWidth,
        // CSS containment: isolates the layout/style recalculations of this cell
        // (see grid-cell.tsx for the rationale).
        contain: "layout style",
      }}
      onClick={() => onClick?.(rowId, dateStr, slot.hour)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, rowId, dateStr, slot.hour);
      }}
    />
  );
}
