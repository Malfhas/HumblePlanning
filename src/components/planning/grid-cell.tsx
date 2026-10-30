"use client";

import { useCallback } from "react";
import { isWeekend, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import { usePlanningStore } from "@/stores/planning-store";

interface GridCellProps {
  date: Date;
  dateStr: string;
  holidayColor?: string;
  conflict?: boolean;
  rowId: string;
  onClick?: (rowId: string, dateStr: string) => void;
  onContextMenu?: (e: React.MouseEvent, rowId: string, dateStr: string) => void;
}

export function GridCell({ date, dateStr, holidayColor, conflict, rowId, onClick, onContextMenu }: GridCellProps) {
  const cellWidth = usePlanningStore((s) => s.cellWidth);
  const cellId = `${rowId}:${dateStr}`;

  // Granular Zustand selectors: subscribe to the derived BOOLEAN specific
  // to this cell (not to the raw `dragOverCellId`). As a result, Zustand
  // re-renders this cell ONLY when its `isDragOver` actually changes.
  // Before, every `dragOverCellId` mutation notified the ~3,650 cells
  // of the grid → all re-evaluated. Now only the previous and the
  // new hovered cell re-render (2 instead of 3,650).
  const isDragOver = usePlanningStore(
    useCallback((s) => s.dragOverCellId === cellId, [cellId])
  );
  const isResizeTarget = usePlanningStore(
    useCallback((s) => {
      const p = s.ganttResizePreview;
      return !!p && p.rowId === rowId && dateStr >= p.startDate && dateStr <= p.endDate;
    }, [rowId, dateStr])
  );
  const isResizing = usePlanningStore((s) => s.ganttResizeActive);

  const weekend = isWeekend(date);
  const isHighlighted = isDragOver || isResizeTarget;
  const today = isToday(date);

  return (
    <div
      data-cell-id={cellId}
      className={cn(
        "border-r border-b h-full transition-colors duration-100 cursor-pointer",
        weekend && !today && !conflict && "bg-muted",
        today && !conflict && !isHighlighted && "bg-orange-50 dark:bg-orange-950/30",
        !weekend && !today && !holidayColor && !conflict && !isHighlighted && "bg-background",
        // Disable hover effect during resize to avoid confusion
        !isResizing && !today && !weekend && !holidayColor && !conflict && "hover:bg-primary/10",
        !isResizing && !today && weekend && !holidayColor && !conflict && "hover:bg-primary/15",
        !isResizing && today && !conflict && "hover:bg-primary/15",
        isHighlighted && !conflict && "!bg-primary/15",
        conflict && "!bg-amber-500/30",
      )}
      style={{
        width: cellWidth,
        minWidth: cellWidth,
        // CSS containment: isolates the layout/style recalculations of this
        // cell from the rest of the page. Reduces the `Recalculate style` cost
        // seen in the DevTools profile when hover/dragOver changes
        // on a cell (without it, the browser may re-check
        // all sibling cells).
        contain: "layout style",
        ...(holidayColor && !isHighlighted && !conflict && !today ? { backgroundColor: `color-mix(in oklch, ${holidayColor} 8%, var(--color-background))` } : {}),
      }}
      onClick={() => onClick?.(rowId, dateStr)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, rowId, dateStr);
        }
      }}
    />
  );
}
