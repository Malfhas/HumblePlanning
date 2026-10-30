/**
 * Slot allocator variant for the hourly view.
 * Compares by time (minutes) instead of dates.
 */

export interface TimeSlotTask {
  id: string;
  startMinutes: number; // minutes from midnight
  endMinutes: number;   // minutes from midnight
  isAllDay?: boolean;   // true if task has no startTime (spans full row)
  createdAt?: string;   // ISO timestamp for stable ordering
}

export interface AllocatedTimeTask extends TimeSlotTask {
  slot: number;
}

/**
 * Parse "HH:MM" or "HH:MM:SS" to total minutes from midnight.
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Allocate vertical slots for time-based tasks within a single row.
 * Tasks that overlap in time range get assigned different slots.
 */
export function allocateTimeSlots(tasks: TimeSlotTask[]): { allocated: AllocatedTimeTask[]; maxSlot: number } {
  if (tasks.length === 0) return { allocated: [], maxSlot: 0 };

  const sorted = [...tasks].sort((a, b) => {
    // All-day tasks first
    const aGroup = a.isAllDay ? 0 : 1;
    const bGroup = b.isAllDay ? 0 : 1;
    if (aGroup !== bGroup) return aGroup - bGroup;
    // Within same group: by start time, then createdAt, then end time
    const cmpStart = a.startMinutes - b.startMinutes;
    if (cmpStart !== 0) return cmpStart;
    const cmpC = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    if (cmpC !== 0) return cmpC;
    return a.endMinutes - b.endMinutes;
  });
  const allocated: AllocatedTimeTask[] = [];
  // slotEnds[i] = endMinutes of last task in slot i
  const slotEnds: number[] = [];

  for (const task of sorted) {
    let assignedSlot = -1;
    for (let i = 0; i < slotEnds.length; i++) {
      if (slotEnds[i] <= task.startMinutes) {
        assignedSlot = i;
        break;
      }
    }
    if (assignedSlot === -1) {
      assignedSlot = slotEnds.length;
      slotEnds.push(0);
    }
    slotEnds[assignedSlot] = task.endMinutes;
    allocated.push({ ...task, slot: assignedSlot });
  }

  let maxSlot = 0;
  for (const at of allocated) {
    if (at.slot > maxSlot) maxSlot = at.slot;
  }

  return { allocated, maxSlot };
}
