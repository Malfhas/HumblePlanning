"use client";

import { useMemo, useCallback, useState, useEffect } from "react";
import { CalendarTaskBlock, isCalendarResizing } from "./calendar-task-block";
import { allocateTimeSlots, type TimeSlotTask } from "@/lib/utils/slot-allocator-time";
import { usePlanningStore } from "@/stores/planning-store";
import type { TimeSlot } from "@/lib/utils/time-slots";
import type { TaskWithUsers } from "@/types";

interface CalendarColumnProps {
  tasks: TaskWithUsers[];
  slots: TimeSlot[];
  slotHeight: number;
  dateStr: string;
  isToday: boolean;
  isWeekendDay?: boolean;
  isHoliday: { label: string; color: string } | null;
  onTaskClick: (taskId: string) => void;
  onCellClick: (dateStr: string, hour: number) => void;
  onTaskContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  onCellContextMenu?: (e: React.MouseEvent, dateStr: string, hour: number) => void;
  defaultStartTime: string;
  defaultEndTime: string;
  workStartHour: number;
  workEndHour: number;
  columnId: string; // userId (team-day) or dateStr (personal) for cell-id
  onResize?: (taskId: string, startTime: string, endTime: string) => void;
}

function parseMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

export function CalendarColumn({
  tasks,
  slots,
  slotHeight,
  dateStr,
  isToday,
  isWeekendDay,
  isHoliday,
  onTaskClick,
  onCellClick,
  onTaskContextMenu,
  onCellContextMenu,
  defaultStartTime,
  defaultEndTime,
  workStartHour,
  workEndHour,
  columnId,
  onResize,
}: CalendarColumnProps) {
  const totalHeight = slots.length * slotHeight;
  const firstHour = slots.length > 0 ? slots[0].hour : 0;
  const lastHour = slots.length > 0 ? slots[slots.length - 1].hour + 1 : 24;
  const totalMinutes = slots.length * 60; // Each slot = 1 hour = 60 min

  // Build a map of hour → slot index for accurate pixel positioning
  const hourToIndex = useMemo(() => {
    const map = new Map<number, number>();
    slots.forEach((s, i) => map.set(s.hour, i));
    return map;
  }, [slots]);

  // Convert minutes (absolute) to pixel Y position within this column
  const minutesToPixel = useCallback((minutes: number): number => {
    const hour = Math.floor(minutes / 60);
    const minuteInHour = minutes % 60;
    const slotIndex = hourToIndex.get(hour);
    if (slotIndex !== undefined) {
      return slotIndex * slotHeight + (minuteInHour / 60) * slotHeight;
    }
    // Hour not in visible slots — find the closest boundary
    // Find the last slot that is before this hour
    let closestIndex = -1;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].hour < hour) closestIndex = i;
    }
    if (closestIndex === -1) return 0; // Before all slots
    // Snap to the bottom edge of the last slot before this hour
    return (closestIndex + 1) * slotHeight;
  }, [hourToIndex, slotHeight, slots]);

  // Drag-over and resize highlight
  const dragOverCellId = usePlanningStore((s) => s.dragOverCellId);
  const dragTaskHours = usePlanningStore((s) => s.dragTaskHours);
  const resizePreview = usePlanningStore((s) => s.resizePreview);

  // Parse drag-over to detect multi-hour highlight range
  const dragHighlightRange = useMemo(() => {
    if (!dragOverCellId) return null;
    const parts = dragOverCellId.split(":");
    if (parts[0] !== columnId || parts[1] !== dateStr) return null; // different column/day
    const hourPart = parts[2];
    if (hourPart == null || hourPart === "allday" || isNaN(parseInt(hourPart, 10))) return null;
    const startHour = parseInt(hourPart, 10);
    const duration = dragTaskHours || 1;
    return { startHour, endHour: startHour + duration };
  }, [dragOverCellId, dragTaskHours, columnId, dateStr]);

  // ===== Now line: red indicator for current time =====
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  useEffect(() => {
    if (!isToday) return;
    const update = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  const nowTop = useMemo(() => {
    if (!isToday) return null;
    const px = minutesToPixel(nowMinutes);
    if (px <= 0 || px >= totalHeight) return null;
    return px;
  }, [isToday, nowMinutes, minutesToPixel, totalHeight]);

  // Allocate overlapping tasks
  const { allocated, maxSlot } = useMemo(() => {
    const slotTasks: TimeSlotTask[] = tasks.map((task) => {
      if (task.startTime) {
        const startM = parseMinutes(task.startTime);
        const endM = task.endTime ? parseMinutes(task.endTime) : startM + 60;
        return {
          id: task.id,
          startMinutes: startM,
          endMinutes: Math.max(endM, startM + 30),
        };
      }
      // No time: span the full visible range using defaults
      const defStartM = parseMinutes(defaultStartTime);
      const defEndM = parseMinutes(defaultEndTime);
      return {
        id: task.id,
        startMinutes: defStartM,
        endMinutes: defEndM,
        isAllDay: true,
      };
    });
    return allocateTimeSlots(slotTasks);
  }, [tasks, defaultStartTime, defaultEndTime]);

  const totalColumns = maxSlot + 1;

  // Map allocated tasks by id for quick lookup
  const allocationMap = useMemo(() => {
    const map = new Map<string, (typeof allocated)[0]>();
    for (const a of allocated) map.set(a.id, a);
    return map;
  }, [allocated]);

  // Convert pixel Y → slot hour
  const pixelToHour = useCallback((y: number): number => {
    const slotIndex = Math.floor(y / slotHeight);
    const clampedIndex = Math.max(0, Math.min(slotIndex, slots.length - 1));
    return slots[clampedIndex]?.hour ?? firstHour;
  }, [slotHeight, slots, firstHour]);

  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isCalendarResizing()) return; // Suppress clicks during resize
      const target = e.target as HTMLElement;
      if (target !== e.currentTarget && !target.dataset.cellId) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      onCellClick(dateStr, pixelToHour(y));
    },
    [dateStr, onCellClick, pixelToHour]
  );

  const handleColumnContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onCellContextMenu) return;
      const target = e.target as HTMLElement;
      if (target.dataset.taskId) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      onCellContextMenu(e, dateStr, pixelToHour(y));
    },
    [onCellContextMenu, dateStr, pixelToHour]
  );

  return (
    <div
      className="relative border-r border-border"
      style={{
        height: totalHeight,
        backgroundColor: isToday
          ? "color-mix(in oklch, var(--primary) 7%, transparent)"
          : isHoliday
            ? `${isHoliday.color}15`
            : isWeekendDay
              ? "color-mix(in srgb, var(--color-muted) 30%, transparent)"
              : undefined,
      }}
      onClick={handleColumnClick}
      onContextMenu={handleColumnContextMenu}
    >
      {/* Holiday label */}
      {isHoliday && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center px-1 py-0.5 text-[10px] font-medium opacity-60"
          style={{ color: isHoliday.color }}
        >
          {isHoliday.label}
        </div>
      )}

      {/* Horizontal grid lines + cell overlays + work period highlighting */}
      {slots.map((slot, i) => {
        const isOutsideWork = slot.hour < workStartHour || slot.hour >= workEndHour;
        const cellId = `${columnId}:${dateStr}:${slot.hour}`;
        const isDragOver = dragHighlightRange != null && slot.hour >= dragHighlightRange.startHour && slot.hour < dragHighlightRange.endHour;
        const isDragOverExact = dragOverCellId === cellId;
        const isResizeTarget = resizePreview && resizePreview.columnId === columnId && (!resizePreview.dateStr || resizePreview.dateStr === dateStr) && slot.hour >= resizePreview.startHour && slot.hour < resizePreview.endHour;
        const isHighlighted = isDragOver || isResizeTarget;
        return (
          <div
            key={slot.hour}
            data-cell-id={cellId}
            className={`absolute inset-x-0 border-b border-border/50 transition-colors duration-100 hover:bg-primary/5 ${isHighlighted ? "!bg-primary/10" : ""} ${isDragOverExact ? "ring-2 ring-inset ring-primary/40" : ""}`}
            style={{
              top: i * slotHeight,
              height: slotHeight,
              backgroundColor: isHighlighted ? undefined : isOutsideWork ? "color-mix(in srgb, var(--color-muted) 20%, transparent)" : undefined,
            }}
          />

        );
      })}

      {/* Now line (current time indicator) */}
      {nowTop !== null && (
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{ top: nowTop, zIndex: 4 }}
        >
          {/* Red circle on left edge */}
          <div
            className="absolute rounded-full bg-red-500"
            style={{ width: 8, height: 8, top: -3, left: -1 }}
          />
          {/* Red line */}
          <div className="h-[2px] w-full bg-red-500" />
        </div>
      )}

      {/* Tasks */}
      {tasks.map((task) => {
        const alloc = allocationMap.get(task.id);
        if (!alloc) return null;

        // Compute vertical position using slot-based mapping
        const top = minutesToPixel(alloc.startMinutes);
        const bottom = minutesToPixel(alloc.endMinutes);
        const height = bottom - top;

        // Horizontal position for overlap
        const colWidth = 100 / totalColumns;
        const left = alloc.slot * colWidth;
        const width = colWidth;

        return (
          <CalendarTaskBlock
            key={task.id}
            task={task}
            top={Math.max(0, top)}
            height={Math.max(24, height)}
            left={left}
            width={width}
            onClick={onTaskClick}
            onContextMenu={onTaskContextMenu}
            onResize={onResize}
            totalHeight={totalHeight}
            totalMinutes={totalMinutes}
            firstHour={firstHour}
            columnId={columnId}
            dateStr={dateStr}
          />
        );
      })}
    </div>
  );
}
