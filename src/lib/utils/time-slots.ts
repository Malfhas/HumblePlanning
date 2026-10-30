import type React from "react";

/**
 * Time slot utilities for the hourly planning view.
 * Each slot = 1 hour. No minute granularity.
 */

export interface TimeSlot {
  hour: number;
  label: string; // e.g. "8h"
  index: number; // contiguous index (0-based)
}

const DEFAULT_HOURS = [8, 9, 10, 11, 14, 15, 16, 17];

/**
 * Parse HOURS_DISPLAYED config string (e.g. "8,9,10,11,14,15,16,17") into sorted hour array.
 */
export function parseHoursConfig(raw?: string | null): number[] {
  if (!raw) return DEFAULT_HOURS;
  const hours = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 23);
  return hours.length > 0 ? hours.sort((a, b) => a - b) : DEFAULT_HOURS;
}

/**
 * Build an ordered array of time slots from hours config.
 * 1 slot per hour.
 */
export function buildTimeSlots(hours: number[]): TimeSlot[] {
  return hours.map((hour, idx) => ({
    hour,
    label: `${hour}h`,
    index: idx,
  }));
}

/**
 * Convert a time string (HH:MM or HH:MM:SS) to a pixel offset within the slot grid.
 * Maps hour → slot index. Positions are snapped to the hour.
 */
export function timeToPixelOffset(
  timeStr: string,
  slots: TimeSlot[],
  slotWidth: number,
): number {
  if (!timeStr || slots.length === 0) return 0;

  const h = parseInt(timeStr.split(":")[0], 10);
  if (isNaN(h)) return 0;

  // Find the slot this hour maps to
  for (let i = slots.length - 1; i >= 0; i--) {
    if (h >= slots[i].hour) {
      return i * slotWidth;
    }
  }

  return 0;
}

/**
 * Get total pixel width of the time slot grid.
 */
export function getTotalSlotsWidth(slots: TimeSlot[], slotWidth: number): number {
  return slots.length * slotWidth;
}

// --- Task time slot classification (visual styling) ---

export type TaskTimeSlot = "all-day" | "morning" | "afternoon" | "custom";

export function getTaskTimeSlot(startTime?: string | null, endTime?: string | null): TaskTimeSlot {
  if (!startTime) return "all-day";
  const startH = parseInt(startTime.split(":")[0], 10);
  const endH = endTime ? parseInt(endTime.split(":")[0], 10) : null;
  if (startH < 12 && (endH === null || endH <= 12)) return "morning";
  if (startH >= 12) return "afternoon";
  return "custom"; // e.g. 10:00-15:00
}

export function getTimeSlotBackground(timeSlot: TaskTimeSlot, bgColor: string): React.CSSProperties {
  // Horizontal gradient (left→right): color on the left for the morning,
  // color on the right for the afternoon. Text is left-aligned, so
  // it naturally sits on the color in the morning and on the light background
  // in the afternoon (see taskBarReadabilityStyle for the text color).
  switch (timeSlot) {
    case "morning":
      return { background: `linear-gradient(to right, ${bgColor} 50%, rgba(255,255,255,0.85) 50%)` };
    case "afternoon":
      return { background: `linear-gradient(to right, rgba(255,255,255,0.85) 50%, ${bgColor} 50%)` };
    default:
      return { backgroundColor: bgColor };
  }
}
