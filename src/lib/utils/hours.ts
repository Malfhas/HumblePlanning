/**
 * Calculate hours for a task based on its time fields.
 * Priority: realDuration > startTime/endTime - break > duration > nbDays * dailyHours
 */
export function calculateTaskHours(
  task: {
    startDate: string;
    endDate: string | null;
    startTime: string | null;
    endTime: string | null;
    duration: string | null;
    breakDuration: string | null;
    realDuration: string | null;
  },
  dailyHours: number
): number {
  if (task.realDuration) {
    return parseFloat(task.realDuration);
  }

  if (task.startTime && task.endTime) {
    const [sh, sm] = task.startTime.split(":").map(Number);
    const [eh, em] = task.endTime.split(":").map(Number);
    let dailyH = (eh + em / 60) - (sh + sm / 60);
    if (task.breakDuration) {
      const [bh, bm] = task.breakDuration.split(":").map(Number);
      dailyH -= (bh + bm / 60);
    }
    const start = new Date(task.startDate);
    const end = task.endDate ? new Date(task.endDate) : start;
    const nbDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return nbDays * Math.max(dailyH, 0);
  }

  if (task.duration) {
    const [durH, durM] = task.duration.split(":").map(Number);
    return durH + (durM || 0) / 60;
  }

  const start = new Date(task.startDate);
  const end = task.endDate ? new Date(task.endDate) : start;
  const nbDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return nbDays * dailyHours;
}

/**
 * Count days between two YYYY-MM-DD dates, inclusive.
 * Returns 0 if start > end.
 */
function daysBetween(start: string, end: string): number {
  if (start > end) return 0;
  const startMs = Date.UTC(
    parseInt(start.slice(0, 4), 10),
    parseInt(start.slice(5, 7), 10) - 1,
    parseInt(start.slice(8, 10), 10),
  );
  const endMs = Date.UTC(
    parseInt(end.slice(0, 4), 10),
    parseInt(end.slice(5, 7), 10) - 1,
    parseInt(end.slice(8, 10), 10),
  );
  return Math.round((endMs - startMs) / 86400000) + 1;
}

/**
 * Calculate task hours limited to the intersection with [periodStart, periodEnd].
 * Prorates the hours proportionally to the overlap when the task extends beyond
 * the period.
 *
 * Returns 0 if the task does not overlap the period at all.
 */
export function calculateTaskHoursInPeriod(
  task: {
    startDate: string;
    endDate: string | null;
    startTime: string | null;
    endTime: string | null;
    duration: string | null;
    breakDuration: string | null;
    realDuration: string | null;
  },
  periodStart: string,
  periodEnd: string,
  dailyHours: number,
): number {
  const taskStart = task.startDate;
  const taskEnd = task.endDate || task.startDate;

  // Overlap window
  const overlapStart = taskStart > periodStart ? taskStart : periodStart;
  const overlapEnd = taskEnd < periodEnd ? taskEnd : periodEnd;
  if (overlapStart > overlapEnd) return 0;

  const overlapDays = daysBetween(overlapStart, overlapEnd);
  const totalTaskDays = daysBetween(taskStart, taskEnd);
  if (overlapDays === 0 || totalTaskDays === 0) return 0;

  // realDuration is a single scalar for the whole task — prorate linearly by days
  if (task.realDuration) {
    const totalReal = parseFloat(task.realDuration);
    return (totalReal / totalTaskDays) * overlapDays;
  }

  // startTime/endTime: daily hours known, multiply by days in overlap
  if (task.startTime && task.endTime) {
    const [sh, sm] = task.startTime.split(":").map(Number);
    const [eh, em] = task.endTime.split(":").map(Number);
    let dailyH = (eh + em / 60) - (sh + sm / 60);
    if (task.breakDuration) {
      const [bh, bm] = task.breakDuration.split(":").map(Number);
      dailyH -= (bh + bm / 60);
    }
    return overlapDays * Math.max(dailyH, 0);
  }

  // duration field: total hours for the whole task — prorate by days
  if (task.duration) {
    const [durH, durM] = task.duration.split(":").map(Number);
    const totalDuration = durH + (durM || 0) / 60;
    return (totalDuration / totalTaskDays) * overlapDays;
  }

  // Fallback: standard daily hours × days in overlap
  return overlapDays * dailyHours;
}
