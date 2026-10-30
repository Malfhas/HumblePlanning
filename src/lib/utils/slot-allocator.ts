/**
 * Slot allocator for overlapping task bars in the planning grid.
 * Greedy algorithm O(n log n) — assigns vertical "slots" to tasks
 * so overlapping tasks stack without visual collision.
 *
 * Priority tasks (holidays, priority=0) are always placed at slot 0.
 * Normal tasks that overlap a holiday skip slot 0; others can use it freely.
 */

export interface SlotTask {
  id: string;
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  priority?: number; // 0 = holiday (slot 0 reserved), 1 = normal (default)
  createdAt?: string; // ISO timestamp for stable ordering
  /** Last modification date. Used as the primary tie-breaker
   *  so freshly moved tasks land in the highest slot
   *  (hence below the bars already in place). Falls back to
   *  createdAt if not provided. */
  updatedAt?: string;
  startTime?: string | null; // HH:MM — used for visual sort order
  endTime?: string | null;
  /** Locked task: used by the hit-test to disable the resize
   *  zones (the visible handle and the "resize-*" hover sub-zone
   *  are removed, so the cursor stays as "pointer"). */
  isLocked?: boolean;
  /** Can the current user resize this task? Combines
   *  the edit scope + the `tasks:resize` permission (and the
   *  equivalent permissions for vehicle/resource assignments).
   *  If `false`, resize handles are neither drawn (renderer)
   *  nor hit-tested (hit-test → "body" subzone → "pointer" cursor).
   *  `undefined` = no information available, allowed by default
   *  (backward compat). */
  canResize?: boolean;
}

export interface AllocatedTask extends SlotTask {
  slot: number;
}

/**
 * Allocate vertical slots for tasks within a single row.
 * Tasks that overlap in date range get assigned different slots.
 * Returns tasks with their assigned slot index (0-based).
 */
export function allocateSlots(tasks: SlotTask[]): { allocated: AllocatedTask[]; maxSlot: number } {
  if (tasks.length === 0) return { allocated: [], maxSlot: 0 };

  const priorityTasks = tasks.filter((t) => (t.priority ?? 1) === 0);
  const normalTasks = tasks.filter((t) => (t.priority ?? 1) !== 0);
  const allocated: AllocatedTask[] = [];

  // Phase 1: assign all priority tasks (holidays) to slot 0
  for (const pt of priorityTasks) {
    allocated.push({ ...pt, slot: 0 });
  }

  if (normalTasks.length === 0) {
    return { allocated, maxSlot: priorityTasks.length > 0 ? 0 : 0 };
  }

  // Helper: does a date range overlap any holiday?
  const overlapsHoliday = (start: string, end: string) =>
    priorityTasks.some((h) => start <= h.endDate && end >= h.startDate);

  // Phase 2: greedy allocation for normal tasks
  // Sort order: by date, then time-slot group (all-day=0, morning=1, afternoon=2, custom=3),
  // then by creation order (stable).
  const timeGroup = (t: SlotTask): number => {
    if (!t.startTime) return 0; // all-day → top
    if (t.startDate !== t.endDate) return 0; // multi-day → same as all-day
    const h = parseInt(t.startTime.split(":")[0], 10);
    const endH = t.endTime ? parseInt(t.endTime.split(":")[0], 10) : null;
    if (h < 12 && (endH === null || endH <= 12)) return 1; // morning
    if (h >= 12) return 2; // afternoon
    return 3; // custom
  };

  const sorted = [...normalTasks].sort((a, b) => {
    const cmp = a.startDate.localeCompare(b.startDate);
    if (cmp !== 0) return cmp;
    // Time-slot group first: all-day/multi-day < morning < afternoon < custom
    const tg = timeGroup(a) - timeGroup(b);
    if (tg !== 0) return tg;
    // Secondary sort by updatedAt (least recently modified task
    // first = low slot = visually on top). A freshly
    // moved/resized task has a recent updatedAt → lands in a
    // higher slot → below the bars already in the cell.
    // Falls back to createdAt then endDate for full stability.
    const aStamp = a.updatedAt ?? a.createdAt ?? "";
    const bStamp = b.updatedAt ?? b.createdAt ?? "";
    const cmpU = aStamp.localeCompare(bStamp);
    if (cmpU !== 0) return cmpU;
    return a.endDate.localeCompare(b.endDate);
  });

  // slotEnds[i] = end date of last task assigned to slot i (empty string = free)
  const slotEnds: string[] = [];

  for (const task of sorted) {
    const skipSlot0 =
      priorityTasks.length > 0 && overlapsHoliday(task.startDate, task.endDate);
    const startSlot = skipSlot0 ? 1 : 0;

    // Find first available slot >= startSlot
    let assignedSlot = -1;
    for (let i = startSlot; i < slotEnds.length; i++) {
      if (slotEnds[i] < task.startDate) {
        assignedSlot = i;
        break;
      }
    }

    if (assignedSlot === -1) {
      // No free slot found — create a new one
      assignedSlot = Math.max(slotEnds.length, startSlot);
      while (slotEnds.length <= assignedSlot) {
        slotEnds.push(""); // fill gaps (e.g. slot 0 placeholder)
      }
    }

    slotEnds[assignedSlot] = task.endDate;
    allocated.push({ ...task, slot: assignedSlot });
  }

  // Compute maxSlot
  let maxSlot = 0;
  for (const at of allocated) {
    if (at.slot > maxSlot) maxSlot = at.slot;
  }

  return { allocated, maxSlot };
}

/**
 * Group tasks by a row key (userId, projectId, etc.) and allocate slots per row.
 * Returns a map of rowId -> { tasks, height } where height = (maxSlot + 1) * taskBarHeight
 */
export function allocateSlotsByRow(
  tasks: (SlotTask & { rowId: string })[],
  taskBarHeight: number = 28
): Map<string, { tasks: AllocatedTask[]; maxSlot: number; height: number }> {
  const byRow = new Map<string, SlotTask[]>();

  for (const task of tasks) {
    const existing = byRow.get(task.rowId) ?? [];
    existing.push(task);
    byRow.set(task.rowId, existing);
  }

  const result = new Map<string, { tasks: AllocatedTask[]; maxSlot: number; height: number }>();

  for (const [rowId, rowTasks] of byRow) {
    const { allocated, maxSlot } = allocateSlots(rowTasks);
    // Small bottom padding (~12 px), just enough to click/create a
    // task in a cell without visual clutter. Dynamic expansion
    // during a drag is handled by the canvas renderer (the
    // target row grows to show the translucent ghost).
    result.set(rowId, {
      tasks: allocated,
      maxSlot,
      height: (maxSlot + 1) * taskBarHeight + 12,
    });
  }

  return result;
}
