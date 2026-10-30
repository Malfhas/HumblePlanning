/**
 * Shared front-end helper to check the PLANNING_MAX_TASKS_PER_DAY
 * limit. Mirror of the server-side `assertDailyTaskLimit()`
 * (src/lib/services/task-service.ts).
 *
 * Parses the config value; 0 / null / invalid → no limit.
 */

export function parseDailyTaskLimit(raw: string | null | undefined): number {
  const n = parseInt(raw ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface TaskLike {
  id: string;
  startDate: string;
  endDate?: string | null;
  users?: { id: string }[] | null;
}

/**
 * Returns true if creating / editing a task with the given
 * parameters would break the limit for at least one user / one day.
 * If `limit <= 0`, returns false (no check).
 */
export function wouldExceedDailyLimit(
  tasks: TaskLike[],
  limit: number,
  params: { userIds: string[]; startDate: string; endDate?: string | null; excludeTaskId?: string | null },
): boolean {
  if (limit <= 0 || params.userIds.length === 0) return false;

  const endDate = params.endDate || params.startDate;
  const excludeId = params.excludeTaskId ?? null;

  // Build the list of days in the target range.
  const targetDays: string[] = [];
  const d = new Date(params.startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");
  while (d <= end) {
    targetDays.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const userSet = new Set(params.userIds);

  for (const day of targetDays) {
    // Count, per user, the existing tasks that cover this day.
    const countPerUser = new Map<string, number>();
    for (const t of tasks) {
      if (t.id === excludeId) continue;
      const tStart = t.startDate;
      const tEnd = t.endDate || t.startDate;
      if (day < tStart || day > tEnd) continue;
      for (const u of t.users ?? []) {
        if (!userSet.has(u.id)) continue;
        countPerUser.set(u.id, (countPerUser.get(u.id) ?? 0) + 1);
      }
    }
    for (const [, count] of countPerUser) {
      if (count >= limit) return true;
    }
  }
  return false;
}
