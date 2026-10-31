import { db } from "@/db";
import { tasks, taskUsers, holidays } from "@/db/schema";
import { eq, and, or, ne, gte, lte, inArray, type SQL } from "drizzle-orm";
import { addDays, addWeeks, addMonths, format } from "date-fns";
import { getConfigValues } from "./config-service";
import { cleanupTaskFiles, cleanupTaskFilesContent } from "./task-service";
import { bulkTaskViolation, loadBulkTaskTargets, type BulkTaskAction, type BulkTaskTarget } from "./task-bulk-service";
import {
  canAssignWithModifyScope,
  getReadableProject,
  getTaskAccessScope,
  hasPermission,
  type TaskAccessScope,
  type UserPermissions,
} from "./permission-service";
import { invalidateCachePrefix } from "@/lib/cache";
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

/**
 * Generate recurring task occurrences in DB. `skipDates`: start dates already
 * held by an occurrence kept from a previous rule (`clearSeriesOccurrences`).
 */
export async function generateRecurringOccurrences(opts: {
  rootTask: typeof tasks.$inferSelect;
  rule: RecurRule;
  userIds: string[];
  skipDates?: Set<string>;
}) {
  const { rootTask, rule, userIds, skipDates } = opts;
  const dates = (await generateOccurrenceDates(rootTask.startDate, rule))
    .filter((date) => !skipDates?.has(date));

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

/**
 * The occurrences of a series that `perms` may act on; the others are left
 * untouched, like locked ones. Same rules as acting on each occurrence alone
 * through PUT/DELETE /api/tasks/[id]: `tasks:delete` for a deletion, then
 * read scope, modify scope and lock (`bulkTaskViolation`). An occurrence was
 * possibly edited on its own since the series was created (other project,
 * business unit or assignees), so the occurrence the user clicked proves nothing
 * about the others.
 *
 * `move`, for an update setting `projectId`: the occurrences moving to that
 * project also need the target-state check of PUT (`canAssignWithModifyScope`
 * with its owner); `project` is null when it is not readable, which leaves
 * every moving occurrence out.
 */
export async function selectSeriesOccurrences(
  perms: UserPermissions,
  occurrences: BulkTaskTarget[],
  action: BulkTaskAction,
  readScope: TaskAccessScope,
  move?: { projectId: string; project: { ownerId: string | null } | null },
): Promise<BulkTaskTarget[]> {
  if (action === "delete" && !hasPermission(perms, "tasks:delete")) return [];
  const allowed = occurrences.filter((t) => bulkTaskViolation(perms, t, action, readScope) === null);
  if (!move || perms.isAdmin) return allowed;
  const { projectId, project } = move;

  // One check per distinct set of assignees: the occurrences of a series
  // mostly share theirs, and the team scope queries the database.
  const verdicts = new Map<string, Promise<boolean>>();
  const canMove = (t: BulkTaskTarget): Promise<boolean> => {
    if (!project) return Promise.resolve(false);
    const userIds = t.users.map((u) => u.id).sort();
    const key = userIds.join(",");
    let verdict = verdicts.get(key);
    if (!verdict) {
      verdict = canAssignWithModifyScope(perms, userIds, project.ownerId);
      verdicts.set(key, verdict);
    }
    return verdict;
  };
  const results = await Promise.all(
    allowed.map((t) => (t.projectId === projectId ? true : canMove(t))),
  );
  return allowed.filter((_, i) => results[i]);
}

/**
 * Unlocked occurrences of the series of `task` covered by `scope`: the whole
 * series, or the occurrences before / after `task`, which is always included.
 */
function seriesScopeCondition(
  task: { id: string; startDate: string },
  rootId: string,
  scope: "all" | "before" | "after",
): SQL | undefined {
  const inScope = scope === "all"
    ? or(eq(tasks.parentId, rootId), eq(tasks.id, rootId))
    : or(
        and(
          eq(tasks.parentId, rootId),
          ne(tasks.id, rootId),
          scope === "before" ? lte(tasks.startDate, task.startDate) : gte(tasks.startDate, task.startDate),
        ),
        eq(tasks.id, task.id),
      );
  return and(inScope, eq(tasks.isLocked, false));
}

/** Loads the occurrences matching `where` and keeps those `perms` may act on. */
async function loadAllowedOccurrenceIds(
  perms: UserPermissions,
  where: SQL | undefined,
  action: BulkTaskAction,
): Promise<string[]> {
  const occurrences = await loadBulkTaskTargets(where);
  if (occurrences.length === 0) return [];
  const allowed = await selectSeriesOccurrences(perms, occurrences, action, await getTaskAccessScope(perms));
  return allowed.map((t) => t.id);
}

/** Deletes occurrences with their assignments and files. */
async function deleteOccurrences(ids: string[]) {
  if (ids.length === 0) return;
  // Read files metadata BEFORE deletion for content-addressable cleanup
  const tasksWithFiles = await db.query.tasks.findMany({ where: inArray(tasks.id, ids), columns: { files: true } });
  const allTaskFiles = tasksWithFiles.flatMap(t => (t.files as { storageKey?: string; name?: string }[] ?? []));
  await db.delete(taskUsers).where(inArray(taskUsers.taskId, ids));
  // Set parentId to null to avoid FK issues, then delete
  await db.update(tasks).set({ parentId: null }).where(inArray(tasks.id, ids));
  await db.delete(tasks).where(inArray(tasks.id, ids));
  await cleanupTaskFilesContent(allTaskFiles);
  await cleanupTaskFiles(ids);
  // Former assignees may lose a project from their assigned_only/own scope
  invalidateCachePrefix("scope:projects:");
}

/**
 * Delete recurring tasks with different scopes. Series scopes only delete the
 * occurrences `perms` may delete (`selectSeriesOccurrences`); `deleted` counts them.
 */
export async function deleteRecurringTasks(
  taskId: string,
  scope: "single" | "all" | "before" | "after",
  perms: UserPermissions,
) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return { deleted: 0 };

  if (scope === "single") {
    const taskFiles = (task.files as { storageKey?: string; name?: string }[] ?? []);
    await db.delete(taskUsers).where(eq(taskUsers.taskId, taskId));
    await db.delete(tasks).where(eq(tasks.id, taskId));
    await cleanupTaskFilesContent(taskFiles);
    await cleanupTaskFiles([taskId]);
    return { deleted: 1 };
  }

  const rootId = await getRootTaskId(taskId);
  const ids = await loadAllowedOccurrenceIds(perms, seriesScopeCondition(task, rootId, scope), "delete");
  await deleteOccurrences(ids);
  return { deleted: ids.length };
}

/**
 * Before a series is regenerated with a new rule: deletes its occurrences
 * (the root excepted) that `perms` may delete, under the rules of
 * `deleteRecurringTasks`, and returns the start dates of the ones kept, which
 * the new occurrences must not duplicate.
 */
export async function clearSeriesOccurrences(rootId: string, perms: UserPermissions): Promise<Set<string>> {
  const ids = await loadAllowedOccurrenceIds(
    perms,
    and(eq(tasks.parentId, rootId), ne(tasks.id, rootId), eq(tasks.isLocked, false)),
    "delete",
  );
  await deleteOccurrences(ids);
  const kept = await db.select({ startDate: tasks.startDate })
    .from(tasks)
    .where(and(eq(tasks.parentId, rootId), ne(tasks.id, rootId)));
  return new Set(kept.map((r) => r.startDate));
}

/**
 * Remove a user from recurring tasks with scope. Series scopes only reach the
 * occurrences `perms` may modify (`selectSeriesOccurrences`); `removed` counts them.
 */
export async function removeUserFromRecurringTasks(
  taskId: string,
  userId: string,
  scope: "single" | "all" | "after",
  perms: UserPermissions,
) {
  if (scope === "single") {
    await db.delete(taskUsers)
      .where(and(eq(taskUsers.taskId, taskId), eq(taskUsers.userId, userId)));
    return { removed: 1 };
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return { removed: 0 };

  const rootId = await getRootTaskId(taskId);
  const ids = await loadAllowedOccurrenceIds(perms, seriesScopeCondition(task, rootId, scope), "update");
  if (ids.length > 0) {
    await db.delete(taskUsers)
      .where(and(inArray(taskUsers.taskId, ids), eq(taskUsers.userId, userId)));
    // The user may lose a project from their assigned_only/own scope
    invalidateCachePrefix(`scope:projects:${userId}:`);
  }
  return { removed: ids.length };
}

/**
 * Propagate updates from root to all children, limited to the occurrences
 * `perms` may update (`selectSeriesOccurrences`). Locked occurrences are
 * frozen: a series edit does not reach them.
 */
export async function propagateTaskUpdate(rootId: string, data: Record<string, unknown>, perms: UserPermissions) {
  // Whitelist of fields that can be propagated
  const allowed = ["title", "notes", "statusId", "projectId", "placeId", "resourceId", "isMilestone", "customField", "link"];
  const propagated: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data) propagated[key] = data[key];
  }
  if (Object.keys(propagated).length === 0) return;

  const occurrences = await loadBulkTaskTargets(
    and(eq(tasks.parentId, rootId), ne(tasks.id, rootId), eq(tasks.isLocked, false)),
  );
  if (occurrences.length === 0) return;

  // Moving occurrences to another project: as in PUT /api/tasks/[id], the
  // target project must be readable (looked up once, only if one moves).
  const projectId = typeof propagated.projectId === "string" ? propagated.projectId : undefined;
  const move = projectId !== undefined && occurrences.some((t) => t.projectId !== projectId)
    ? { projectId, project: await getReadableProject(perms, projectId) }
    : undefined;

  const ids = (await selectSeriesOccurrences(perms, occurrences, "update", await getTaskAccessScope(perms), move))
    .map((t) => t.id);
  if (ids.length === 0) return;
  await db.update(tasks)
    .set(propagated)
    .where(inArray(tasks.id, ids));
  if (move) invalidateCachePrefix("scope:projects:");
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
