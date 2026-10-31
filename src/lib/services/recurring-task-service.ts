import { db } from "@/db";
import { tasks, taskUsers, holidays } from "@/db/schema";
import { eq, and, or, ne, gte, lte, inArray } from "drizzle-orm";
import { addDays, addWeeks, addMonths, format } from "date-fns";
import { getConfigValues } from "./config-service";
import { cleanupTaskFiles, cleanupTaskFilesContent } from "./task-service";
import type { RecurRule } from "@/lib/validators/task";

const MAX_OCCURRENCES = 2555;

/**
 * Read working days from PLANNING_DAYS_OF_WEEK_DISPLAY config.
 * Format: { "1": { inclus: true, ... }, ... "7": ... } where 1=Monday, 7=Sunday.
 * Returns Set of JS day numbers (0=Sunday, 1=Monday, ..., 6=Saturday).
 */
export async function getWorkingDays(): Promise<Set<number>> {
  const values = await getConfigValues(["PLANNING_DAYS_OF_WEEK_DISPLAY"]);
  const raw = values.PLANNING_DAYS_OF_WEEK_DISPLAY;
  const workingDays = new Set<number>();

  if (raw) {
    try {
      const config = JSON.parse(raw) as Record<string, { inclus: boolean }>;
      // Map: config key 1=Monday→JS 1, 2=Tuesday→JS 2, ..., 7=Sunday→JS 0
      for (const [key, val] of Object.entries(config)) {
        if (val.inclus) {
          const configDay = parseInt(key, 10); // 1=Mon..7=Sun
          const jsDay = configDay === 7 ? 0 : configDay; // 7→0 (Sunday), rest stays
          workingDays.add(jsDay);
        }
      }
    } catch {
      // Fallback: Mon-Fri working
      return new Set([1, 2, 3, 4, 5]);
    }
  } else {
    // No config: default Mon-Fri
    return new Set([1, 2, 3, 4, 5]);
  }

  return workingDays;
}

/** Load all holiday dates in a range */
async function getHolidaySet(startDate: string, endDate: string): Promise<Set<string>> {
  const rows = await db.select({ date: holidays.date })
    .from(holidays)
    .where(and(gte(holidays.date, startDate), lte(holidays.date, endDate)));
  return new Set(rows.map(r => r.date));
}

/** Check if a date is non-working (weekend or holiday) */
function isNonWorkingDay(date: Date, workingDays: Set<number>, holidaySet: Set<string>): boolean {
  if (!workingDays.has(date.getDay())) return true;
  if (holidaySet.has(format(date, "yyyy-MM-dd"))) return true;
  return false;
}

/** Apply exception rule: shift to next working day, skip, or include as-is */
function applyException(
  date: Date,
  workingDays: Set<number>,
  holidaySet: Set<string>,
  exception: string
): Date | null {
  if (!isNonWorkingDay(date, workingDays, holidaySet)) return date;

  switch (exception) {
    case "include":
      return date;
    case "skip":
      return null;
    case "shift": {
      let shifted = date;
      for (let i = 0; i < 30; i++) {
        shifted = addDays(shifted, 1);
        if (!isNonWorkingDay(shifted, workingDays, holidaySet)) return shifted;
      }
      return null; // safety: couldn't find a working day within 30 days
    }
    default:
      return null;
  }
}

/** Generate occurrence dates from a start date + recurrence rule */
export async function generateOccurrenceDates(
  startDate: string,
  rule: RecurRule
): Promise<string[]> {
  const workingDays = await getWorkingDays();
  const holidaySet = await getHolidaySet(startDate, rule.recurEndDate);
  const dates: string[] = [];
  let current = new Date(startDate);
  const end = new Date(rule.recurEndDate);
  const freq = rule.recurFrequency;

  // Advance to first occurrence after root
  current = advanceDate(current, rule.recurType, freq, rule.recurDayOfWeek);

  while (current <= end && dates.length < MAX_OCCURRENCES) {
    const adjusted = applyException(current, workingDays, holidaySet, rule.recurException);
    if (adjusted) {
      dates.push(format(adjusted, "yyyy-MM-dd"));
    }
    current = advanceDate(current, rule.recurType, freq, rule.recurDayOfWeek);
  }

  return dates;
}

function advanceDate(current: Date, type: string, freq: number, dayOfWeek?: number): Date {
  switch (type) {
    case "daily":
      return addDays(current, freq);
    case "weekly":
      return addWeeks(current, freq);
    case "monthly":
      return addMonths(current, freq);
    default:
      return addDays(current, freq);
  }
}

/** Generate recurring task occurrences in DB */
export async function generateRecurringOccurrences(opts: {
  rootTask: typeof tasks.$inferSelect;
  rule: RecurRule;
  userIds: string[];
}) {
  const { rootTask, rule, userIds } = opts;
  const dates = await generateOccurrenceDates(rootTask.startDate, rule);

  if (dates.length === 0) return [];

  // Calculate duration in days
  const daysDiff = rootTask.endDate
    ? Math.round((new Date(rootTask.endDate).getTime() - new Date(rootTask.startDate).getTime()) / 86400000)
    : 0;

  const taskValues = dates.map(date => {
    const endDate = daysDiff > 0
      ? format(addDays(new Date(date), daysDiff), "yyyy-MM-dd")
      : date;

    return {
      parentId: rootTask.id,
      projectId: rootTask.projectId,
      title: rootTask.title,
      notes: rootTask.notes,
      statusId: rootTask.statusId,
      placeId: rootTask.placeId,
      resourceId: rootTask.resourceId,
      isMilestone: rootTask.isMilestone,
      startDate: date,
      endDate,
      startTime: rootTask.startTime,
      endTime: rootTask.endTime,
      duration: rootTask.duration,
      durationDetails: rootTask.durationDetails,
      breakDuration: rootTask.breakDuration,
      customField: rootTask.customField,
      link: rootTask.link,
      files: rootTask.files,
      creatorId: rootTask.creatorId,
      lastModifierId: rootTask.lastModifierId,
    };
  });

  // Batch insert tasks
  const inserted = await db.insert(tasks).values(taskValues).returning({ id: tasks.id });

  // Batch insert task_users
  if (userIds.length > 0 && inserted.length > 0) {
    const tuValues = inserted.flatMap(t =>
      userIds.map(userId => ({ taskId: t.id, userId }))
    );
    await db.insert(taskUsers).values(tuValues);
  }

  return inserted;
}

/** Delete recurring tasks with different scopes */
export async function deleteRecurringTasks(
  taskId: string,
  scope: "single" | "all" | "before" | "after"
) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return { deleted: 0 };

  const rootId = await getRootTaskId(taskId);

  switch (scope) {
    case "single": {
      const taskFiles = (task.files as { storageKey?: string; name?: string }[] ?? []);
      await db.delete(taskUsers).where(eq(taskUsers.taskId, taskId));
      await db.delete(tasks).where(eq(tasks.id, taskId));
      await cleanupTaskFilesContent(taskFiles);
      await cleanupTaskFiles([taskId]);
      return { deleted: 1 };
    }
    case "all": {
      // Root + children. Locked occurrences are kept: a lock freezes the task,
      // as DELETE /api/tasks/[id] enforces for a single one.
      const rows = await db.select({ id: tasks.id })
        .from(tasks)
        .where(and(or(eq(tasks.parentId, rootId), eq(tasks.id, rootId)), eq(tasks.isLocked, false)));
      const allIds = rows.map(r => r.id);
      if (allIds.length === 0) return { deleted: 0 };
      // Read files metadata BEFORE deletion for content-addressable cleanup
      const allTasksWithFiles = allIds.length > 0
        ? await db.query.tasks.findMany({ where: inArray(tasks.id, allIds), columns: { files: true } })
        : [];
      const allTaskFiles = allTasksWithFiles.flatMap(t => (t.files as { storageKey?: string; name?: string }[] ?? []));
      // Delete task_users first
      if (allIds.length > 0) {
        await db.delete(taskUsers).where(inArray(taskUsers.taskId, allIds));
      }
      // Set parentId to null to avoid FK issues, then delete
      await db.update(tasks)
        .set({ parentId: null })
        .where(inArray(tasks.id, allIds));
      await db.delete(tasks).where(inArray(tasks.id, allIds));
      await cleanupTaskFilesContent(allTaskFiles);
      await cleanupTaskFiles(allIds);
      return { deleted: allIds.length };
    }
    case "before": {
      const ids = await db.select({ id: tasks.id })
        .from(tasks)
        .where(and(
          eq(tasks.parentId, rootId),
          ne(tasks.id, rootId),
          lte(tasks.startDate, task.startDate),
          eq(tasks.isLocked, false)
        ));
      // Include the current task
      const toDelete = [...ids.map(i => i.id), taskId];
      const uniqueIds = [...new Set(toDelete)];
      if (uniqueIds.length > 0) {
        // Read files metadata BEFORE deletion for content-addressable cleanup
        const tasksWithFiles = await db.query.tasks.findMany({ where: inArray(tasks.id, uniqueIds), columns: { files: true } });
        const allTaskFiles = tasksWithFiles.flatMap(t => (t.files as { storageKey?: string; name?: string }[] ?? []));
        await db.delete(taskUsers).where(inArray(taskUsers.taskId, uniqueIds));
        await db.update(tasks).set({ parentId: null }).where(inArray(tasks.id, uniqueIds));
        await db.delete(tasks).where(inArray(tasks.id, uniqueIds));
        await cleanupTaskFilesContent(allTaskFiles);
        await cleanupTaskFiles(uniqueIds);
      }
      return { deleted: uniqueIds.length };
    }
    case "after": {
      const ids = await db.select({ id: tasks.id })
        .from(tasks)
        .where(and(
          eq(tasks.parentId, rootId),
          ne(tasks.id, rootId),
          gte(tasks.startDate, task.startDate),
          eq(tasks.isLocked, false)
        ));
      const toDelete = [...ids.map(i => i.id), taskId];
      const uniqueIds = [...new Set(toDelete)];
      if (uniqueIds.length > 0) {
        // Read files metadata BEFORE deletion for content-addressable cleanup
        const tasksWithFiles = await db.query.tasks.findMany({ where: inArray(tasks.id, uniqueIds), columns: { files: true } });
        const allTaskFiles = tasksWithFiles.flatMap(t => (t.files as { storageKey?: string; name?: string }[] ?? []));
        await db.delete(taskUsers).where(inArray(taskUsers.taskId, uniqueIds));
        await db.update(tasks).set({ parentId: null }).where(inArray(tasks.id, uniqueIds));
        await db.delete(tasks).where(inArray(tasks.id, uniqueIds));
        await cleanupTaskFilesContent(allTaskFiles);
        await cleanupTaskFiles(uniqueIds);
      }
      return { deleted: uniqueIds.length };
    }
  }
}

/** Remove a user from recurring tasks with scope */
export async function removeUserFromRecurringTasks(
  taskId: string,
  userId: string,
  scope: "single" | "all" | "after"
) {
  if (scope === "single") {
    await db.delete(taskUsers)
      .where(and(eq(taskUsers.taskId, taskId), eq(taskUsers.userId, userId)));
    return { removed: 1 };
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return { removed: 0 };

  const rootId = await getRootTaskId(taskId);

  let targetIds: string[];
  if (scope === "all") {
    const rows = await db.select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentId, rootId));
    targetIds = [...rows.map(r => r.id), rootId];
  } else {
    // "after"
    const rows = await db.select({ id: tasks.id })
      .from(tasks)
      .where(and(
        eq(tasks.parentId, rootId),
        ne(tasks.id, rootId),
        gte(tasks.startDate, task.startDate)
      ));
    targetIds = [...rows.map(r => r.id), taskId];
  }

  const uniqueIds = [...new Set(targetIds)];
  if (uniqueIds.length > 0) {
    await db.delete(taskUsers)
      .where(and(inArray(taskUsers.taskId, uniqueIds), eq(taskUsers.userId, userId)));
  }
  return { removed: uniqueIds.length };
}

/** Propagate updates from root to all children */
export async function propagateTaskUpdate(rootId: string, data: Record<string, unknown>) {
  // Whitelist of fields that can be propagated
  const allowed = ["title", "notes", "statusId", "projectId", "placeId", "resourceId", "isMilestone", "customField", "link"];
  const propagated: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data) propagated[key] = data[key];
  }
  if (Object.keys(propagated).length === 0) return;

  // Locked occurrences are frozen: a series edit does not reach them
  await db.update(tasks)
    .set(propagated)
    .where(and(eq(tasks.parentId, rootId), ne(tasks.id, rootId), eq(tasks.isLocked, false)));
}

/** Get the root task ID from any child */
export async function getRootTaskId(taskId: string): Promise<string> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { id: true, parentId: true },
  });
  if (!task) return taskId;
  if (!task.parentId || task.parentId === task.id) return task.id;
  return task.parentId;
}
