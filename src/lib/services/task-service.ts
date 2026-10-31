import { db } from "@/db";
import { tasks, taskUsers, projects } from "@/db/schema";
import { eq, and, lt, lte, like, or, sql, inArray } from "drizzle-orm";
import type { CreateTask, UpdateTask, TaskFilters } from "@/lib/validators/task";
import { logAudit, computeChanges, pickAuditFields } from "./audit-service";
import { scheduleTaskCreated, scheduleTaskUpdated, scheduleTaskDeleted } from "./notification-queue";
import { schedulePushTaskCreated, schedulePushTaskUpdated, schedulePushTaskDeleted } from "./push-notification-queue";
import { invalidateCachePrefix } from "@/lib/cache";
import { rm, unlink } from "node:fs/promises";
import { USER_SECRET_COLUMNS_EXCLUDED } from "@/lib/utils/user-columns";
import { isValidStorageKey, safeUploadPath } from "@/lib/utils/upload-paths";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";

/**
 * Invalidates the `scope:projects:${userId}:*` cache for users whose
 * task assignment changes (create/update/delete/move/copy/bulk/
 * removeUserFromTask). Important for the "own" and "assigned_only" scopes
 * where the list of visible projects is derived from current assignments.
 */
function invalidateScopeForUsers(userIds: Iterable<string>) {
  for (const uid of userIds) {
    invalidateCachePrefix(`scope:projects:${uid}:`);
  }
}

/**
 * Checks that no (user, day) pair in [startDate..endDate] exceeds
 * the PLANNING_MAX_TASKS_PER_DAY limit. Throws `AppError("tasks.errors.dailyLimitReached")`
 * (409, params `limit` and `day` in yyyy-MM-dd format) if the limit is reached
 * on at least one day for at least one of the given users.
 *
 * If the config is missing or ≤ 0, no check is performed.
 * `excludeTaskId` excludes the task being edited/moved so it does not
 * count itself.
 */
export async function assertDailyTaskLimit(params: {
  userIds: string[];
  startDate: string;
  endDate?: string | null;
  excludeTaskId?: string | null;
}) {
  if (params.userIds.length === 0) return;
  const { getConfigValue } = await import("./config-service");
  const raw = await getConfigValue("PLANNING_MAX_TASKS_PER_DAY");
  const limit = parseInt(raw ?? "0", 10);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const endDate = params.endDate || params.startDate;
  const excludeClause = params.excludeTaskId
    ? sql`AND t.id != ${params.excludeTaskId}`
    : sql``;

  // For each day in [startDate..endDate], for each targeted user,
  // count the existing tasks that overlap that day.
  const userIdList = sql.join(params.userIds.map((id) => sql`${id}::uuid`), sql`, `);
  // i18n-ignore SQL query (no displayed text)
  const rows = await db.execute<{ user_id: string; day: string; n: number }>(sql`
    SELECT tu.user_id,
           (t.start_date + d.ofs)::date AS day,
           COUNT(*)::int AS n
      FROM ${taskUsers} tu
      JOIN ${tasks} t ON t.id = tu.task_id
      CROSS JOIN LATERAL generate_series(
        0,
        GREATEST((COALESCE(t.end_date, t.start_date) - t.start_date)::int, 0),
        1
      ) AS d(ofs)
     WHERE tu.user_id IN (${userIdList})
       AND (t.start_date + d.ofs)::date BETWEEN ${params.startDate}::date AND ${endDate}::date
       ${excludeClause}
     GROUP BY tu.user_id, (t.start_date + d.ofs)::date
    HAVING COUNT(*) >= ${limit}
     LIMIT 1
  `);

  if (rows.length > 0) {
    const r = rows[0];
    // `day` in ISO: formatted in the reader's language at translation time (localizeErrorParams).
    const rawDay: unknown = r.day;
    const day = rawDay instanceof Date ? rawDay.toISOString().slice(0, 10) : String(rawDay).slice(0, 10);
    throw new AppError("tasks.errors.dailyLimitReached", { status: 409, params: { limit, day } });
  }
}

/** Check if a task is locked */
export async function isTaskLocked(id: string): Promise<boolean> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    columns: { isLocked: true },
  });
  return task?.isLocked === true;
}

/** Delete all uploaded files for the given task IDs from the filesystem (legacy task-specific folders) */
export async function cleanupTaskFiles(taskIds: string[]) {
  for (const id of taskIds) {
    const dir = safeUploadPath("tasks", id);
    if (!dir) {
      logger.warn("system", "Skipped task folder cleanup: invalid task id", { taskId: id });
      continue;
    }
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  }
}

/** Delete content-addressable files, checking reference counts before deleting */
export async function cleanupTaskFilesContent(files: { storageKey?: string; name?: string }[]) {
  for (const f of files) {
    if (!f.storageKey) continue;
    // Metadata comes from the database: never let it reach the filesystem
    // (nor the LIKE pattern below) unless it is a content-hash key.
    const storagePath = isValidStorageKey(f.storageKey) ? safeUploadPath("files", f.storageKey) : null;
    if (!storagePath) {
      logger.warn("system", "Skipped file cleanup: invalid storage key", { storageKey: String(f.storageKey).slice(0, 100) });
      continue;
    }
    // Check if any other task still references this storageKey
    const refResult = await db.execute(sql`
      SELECT count(*)::int AS count FROM tasks
      WHERE files::text LIKE ${'%' + f.storageKey + '%'}
    `);
    const refCount = Number((refResult as any)[0]?.count ?? 0);
    if (refCount === 0) {
      try { await unlink(storagePath); } catch {}
    }
  }
}

// Helper: map task with taskUsers to include users array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTaskWithUsers(task: any) {
  if (!task) return task;
  const users = task.taskUsers?.map((tu: { user: unknown }) => tu.user).filter(Boolean).map((u: any) => ({
    ...u,
    name: [u.firstName, u.name].filter(Boolean).join(" "),
  })) ?? [];
  const { taskUsers: _, ...rest } = task;
  // Also map creator and lastModifier display names
  if (rest.creator) rest.creator = { ...rest.creator, name: [rest.creator.firstName, rest.creator.name].filter(Boolean).join(" ") };
  if (rest.lastModifier) rest.lastModifier = { ...rest.lastModifier, name: [rest.lastModifier.firstName, rest.lastModifier.name].filter(Boolean).join(" ") };
  return { ...rest, users };
}

/**
 * Optional access-scope filters applied by GET /api/tasks to enforce
 * permission-based visibility on top of user-provided filters.
 * Both values follow the convention of `getVisibleProjectIds` / `getVisibleUserIds`:
 *   - `null` means "no restriction" (admin / scope=all)
 *   - `string[]` means "only these IDs are visible" (empty array → nothing visible)
 */
export interface TaskAccessScope {
  accessibleProjectIds?: string[] | null;
  accessibleUserIds?: string[] | null;
}

export async function getTasks(filters: TaskFilters, scope: TaskAccessScope = {}) {
  const conditions = [];

  if (filters.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters.statusId) conditions.push(eq(tasks.statusId, filters.statusId));
  if (filters.placeId) conditions.push(eq(tasks.placeId, filters.placeId));
  if (filters.resourceId) conditions.push(eq(tasks.resourceId, filters.resourceId));

  // BU filter: subquery on projects. Tasks have no business_unit_id
  // directly — they inherit their project's one (projects.business_unit_id).
  // Applied in SQL to avoid sending tasks from other BUs to the client.
  if (filters.businessUnitIds && filters.businessUnitIds.length > 0) {
    conditions.push(
      inArray(
        tasks.projectId,
        db.select({ id: projects.id }).from(projects).where(inArray(projects.businessUnitId, filters.businessUnitIds))
      )
    );
  }
  // Overlap: include tasks that span into the date range, not just tasks starting in it
  if (filters.startDate) conditions.push(sql`COALESCE(${tasks.endDate}, ${tasks.startDate}) >= ${filters.startDate}`);
  if (filters.endDate) conditions.push(lte(tasks.startDate, filters.endDate));
  if (filters.search) {
    conditions.push(
      or(
        like(tasks.title, `%${filters.search}%`),
        like(tasks.notes, `%${filters.search}%`)
      )
    );
  }

  // Access scope: project visibility
  // null → no restriction; [] → nothing visible; [...] → strict whitelist
  if (scope.accessibleProjectIds !== null && scope.accessibleProjectIds !== undefined) {
    if (scope.accessibleProjectIds.length === 0) {
      return { data: [], total: 0, page: filters.page, limit: filters.limit };
    }
    conditions.push(inArray(tasks.projectId, scope.accessibleProjectIds));
  }

  // Access scope: user visibility
  // A task is visible ONLY IF at least one assigned user is in the whitelist.
  // Orphan tasks (no assigned users) are NOT visible to scope-restricted users —
  // only admins / scope="all" see them (accessibleUserIds = null → filter skipped).
  if (scope.accessibleUserIds !== null && scope.accessibleUserIds !== undefined) {
    if (scope.accessibleUserIds.length === 0) {
      return { data: [], total: 0, page: filters.page, limit: filters.limit };
    }
    const visibleRows = await db
      .selectDistinct({ id: taskUsers.taskId })
      .from(taskUsers)
      .where(inArray(taskUsers.userId, scope.accessibleUserIds));
    const visibleTaskIds = visibleRows.map((r) => r.id);
    if (visibleTaskIds.length === 0) {
      return { data: [], total: 0, page: filters.page, limit: filters.limit };
    }
    conditions.push(inArray(tasks.id, visibleTaskIds));
  }

  const offset = (filters.page - 1) * filters.limit;

  // If filtering by userId, we need to find tasks that have this user in task_users
  let taskIdsForUser: string[] | undefined;
  if (filters.userId) {
    const userTaskRows = await db.select({ taskId: taskUsers.taskId })
      .from(taskUsers)
      .where(eq(taskUsers.userId, filters.userId));
    taskIdsForUser = userTaskRows.map(r => r.taskId);
    if (taskIdsForUser.length === 0) {
      return { data: [], total: 0, page: filters.page, limit: filters.limit };
    }
    conditions.push(inArray(tasks.id, taskIdsForUser));
  }

  // If unpaginated (used by /planning), return ALL tasks
  // in the range without limit/offset. Otherwise normal pagination.
  const unpaginated = filters.unpaginated === true;

  // In unpaginated mode (planning), the separate `count(*)` is useless:
  // the client does not use `total` for the planning (all tasks
  // are already in `data`). Skipping the aggregation saves a 2nd full
  // scan of the tasks table (~50-200 ms depending on volume).
  const [data, countResult] = await Promise.all([
    db.query.tasks.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      // Projection targeted at the task columns: we only load the
      // fields actually used by the grid and the tooltips. The
      // heavy or grid-irrelevant columns (`link`, `customField`, the
      // 5 recurrence fields, `placeTextLat/Lng`, `durationDetails`,
      // `linkId`) are excluded. The full content is reloaded via
      // `getTaskById` when the user opens the edit modal.
      columns: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        notes: true,           // truncated after fetch (see below)
        // `files` (jsonb) deliberately EXCLUDED: the array can weigh several
        // KB per task (id, originalName, mimeType, size, uploadedAt, etc.).
        // In the grid, we only need to know whether there is at least 1 file
        // to show the icon — available via the `fileCount` computed in
        // SQL below. The edit modal reloads the full `files`
        // via `getTaskById` when a task is clicked.
        isLocked: true,
        isMilestone: true,
        parentId: true,
        placeText: true,       // shown as fallback in the tooltip
        projectId: true,
        statusId: true,
        placeId: true,         // for the rowKey in places view
        resourceId: true,      // for the rowKey in resources view
        creatorId: true,
        lastModifierId: true,
        createdAt: true,
        updatedAt: true,
      },
      extras: {
        // Number of files per task computed directly in SQL.
        // `jsonb_array_length` returns null if the column is null →
        // coalesce to 0 to get a stable number on the client.
        fileCount: sql<number>`coalesce(jsonb_array_length(${tasks.files}), 0)`.as("file_count"),
      },
      // Projection targeted at the relations: we only load the columns
      // actually used on the client. Without this projection, each
      // relation (project, user, BU) embeds all its fields and this data
      // is DUPLICATED on every task that references it — a user assigned
      // to 80 tasks over 2 months comes out 80 times in full in the response.
      with: {
        project: {
          columns: {
            id: true, name: true, color: true, businessNumber: true,
            businessUnitId: true, address: true, addressLat: true,
            addressLng: true, ownerId: true,
          },
          with: {
            businessUnit: {
              columns: { id: true, name: true, number: true, color: true },
            },
          },
        },
        status: {
          columns: {
            id: true, name: true, color: true,
            bold: true, italic: true, strikethrough: true, underline: true,
          },
        },
        place: { columns: { id: true, name: true } },
        resource: { columns: { id: true, name: true } },
        taskUsers: {
          with: {
            user: {
              columns: {
                id: true, name: true, firstName: true, color: true,
                image: true, businessUnitId: true, teamId: true,
              },
              with: {
                businessUnit: {
                  columns: { id: true, name: true, number: true, color: true },
                },
              },
            },
          },
        },
        creator: { columns: { id: true, name: true, firstName: true } },
        lastModifier: { columns: { id: true, name: true, firstName: true } },
      },
      ...(unpaginated ? {} : { limit: filters.limit, offset }),
      // `id` added as a tie-breaker to guarantee a deterministic order
      // when several tasks share the same updatedAt/startDate (common
      // after a seed that inserts thousands of tasks at the same
      // instant) — prevents the first 500 tasks from changing from one
      // refetch to the next.
      orderBy: (tasks, { desc, asc }) => [desc(tasks.updatedAt), desc(tasks.startDate), asc(tasks.id)],
    }),
    // Skipped sentinel — never read in unpaginated mode, the total
    // is computed from `data.length` below (equivalent to the real
    // count since there is no limit/offset).
    unpaginated
      ? Promise.resolve([{ count: 0 }])
      : db.select({ count: sql<number>`count(*)` }).from(tasks).where(conditions.length > 0 ? and(...conditions) : undefined),
  ]);

  // Truncates notes to 200 characters for the list payload: the planning
  // tooltip already applies `line-clamp-3` (≈ 150 chars max displayed).
  // The task edit modal reloads the full notes via
  // `getTaskById` on mount, so no functional loss.
  // Measured: saves ~30-50% of the payload on ranges with rich notes.
  const NOTES_PREVIEW_MAX = 200;
  const truncatedData = data.map((t) => {
    const mapped = mapTaskWithUsers(t);
    if (mapped?.notes && typeof mapped.notes === "string" && mapped.notes.length > NOTES_PREVIEW_MAX) {
      mapped.notes = mapped.notes.slice(0, NOTES_PREVIEW_MAX) + "…";
    }
    return mapped;
  });

  // In unpaginated mode, the separate `count` is skipped → return the
  // payload size as the total (enough for the planning, which does not
  // paginate). Otherwise, the real `COUNT(*)` value.
  const total = unpaginated ? truncatedData.length : Number(countResult[0].count);

  return {
    data: truncatedData,
    total,
    page: filters.page,
    limit: filters.limit,
  };
}

export async function getTaskById(id: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: {
      project: { with: { businessUnit: true } },
      status: true,
      place: true,
      resource: true,
      taskUsers: { with: { user: { columns: USER_SECRET_COLUMNS_EXCLUDED } } },
      creator: { columns: { id: true, name: true, firstName: true } },
      lastModifier: { columns: { id: true, name: true, firstName: true } },
    },
  });
  return mapTaskWithUsers(task);
}

export async function createTask(data: CreateTask, creatorId?: string) {
  const { userIds, ...taskData } = data;

  const [task] = await db.insert(tasks).values({
    ...taskData,
    creatorId: creatorId ?? undefined,
    lastModifierId: creatorId ?? undefined,
  }).returning();

  // Insert task_users
  if (userIds.length > 0) {
    await db.insert(taskUsers).values(
      userIds.map(userId => ({ taskId: task.id, userId }))
    );
  }

  const auditValues = pickAuditFields(task as unknown as Record<string, unknown>, "task");
  auditValues.userIds = userIds;
  await logAudit({
    userId: creatorId,
    action: "create",
    entityType: "task",
    entityId: task.id,
    newValues: auditValues,
  });

  scheduleTaskCreated(task as unknown as Parameters<typeof scheduleTaskCreated>[0], userIds, creatorId);
  schedulePushTaskCreated(task as unknown as Parameters<typeof schedulePushTaskCreated>[0], userIds, creatorId);

  // Scope cache: the new assignees may see a new project in their
  // `assigned_only/own` scope → invalidate their scope:projects.
  invalidateScopeForUsers(userIds);

  // Return full task with all relations so the client optimistic swap is seamless
  return getTaskById(task.id);
}

export async function updateTask(id: string, data: UpdateTask, modifierId?: string) {
  const { userIds, ...taskData } = data;

  // Read old state for audit
  const oldTask = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });

  const [task] = await db.update(tasks)
    .set({ ...taskData, lastModifierId: modifierId ?? undefined })
    .where(eq(tasks.id, id))
    .returning();

  if (!task) return null;

  // Load old userIds before modifying junction table (for notification diff)
  const oldUserRows = await db.select({ userId: taskUsers.userId }).from(taskUsers).where(eq(taskUsers.taskId, id));
  const oldUserIds = oldUserRows.map(r => r.userId);

  // Update task_users if provided
  if (userIds !== undefined) {
    await db.delete(taskUsers).where(eq(taskUsers.taskId, id));
    if (userIds.length > 0) {
      await db.insert(taskUsers).values(
        userIds.map(userId => ({ taskId: id, userId }))
      );
    }
  }

  if (oldTask) {
    const changes = computeChanges(
      oldTask as unknown as Record<string, unknown>,
      taskData as Record<string, unknown>,
      "task"
    );
    if (changes) {
      await logAudit({
        userId: modifierId,
        action: "update",
        entityType: "task",
        entityId: id,
        oldValues: changes.old,
        newValues: changes.new,
        changeCount: changes.count,
        metadata: !changes.old.title ? { title: oldTask.title } : undefined,
      });
    }

    const currentUserIds = userIds !== undefined ? userIds : oldUserIds;
    const oldTaskWithUserIds = { ...(oldTask as unknown as Record<string, unknown>), userIds: oldUserIds };
    const taskWithUserIds = userIds !== undefined
      ? { ...(task as unknown as Record<string, unknown>), userIds }
      : task;
    scheduleTaskUpdated(
      taskWithUserIds as unknown as Parameters<typeof scheduleTaskUpdated>[0],
      oldTaskWithUserIds,
      currentUserIds,
      modifierId
    );
    schedulePushTaskUpdated(
      taskWithUserIds as unknown as Parameters<typeof schedulePushTaskUpdated>[0],
      oldTaskWithUserIds,
      currentUserIds,
      modifierId
    );
  }

  // Scope cache: if the set of assignees changes, the added and removed
  // users may see their scope (`own/assigned_only`) change.
  if (userIds !== undefined) {
    const removed = oldUserIds.filter((uid) => !userIds.includes(uid));
    const added = userIds.filter((uid) => !oldUserIds.includes(uid));
    invalidateScopeForUsers([...removed, ...added]);
  }

  // API contract consistency: return the full task with its relations
  // (project, status, users via mapTaskWithUsers) instead of a raw row.
  // Aligns update with create/copy and ensures MCP/optimistic updates
  // receive a shape consistent with TaskWithUsers.
  return getTaskById(id);
}

export async function deleteTask(id: string, deleterId?: string) {
  // Read old state + user assignments for audit
  const oldTask = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  const oldUserRows = await db.select({ userId: taskUsers.userId }).from(taskUsers).where(eq(taskUsers.taskId, id));

  // Extract files metadata BEFORE deletion (needed for content-addressable cleanup)
  const taskFiles = (oldTask?.files as { storageKey?: string; name?: string }[] ?? []);

  const [task] = await db.delete(tasks).where(eq(tasks.id, id)).returning();

  if (task && oldTask) {
    const oldUserIds = oldUserRows.map(r => r.userId);
    const auditValues = pickAuditFields(oldTask as unknown as Record<string, unknown>, "task", true);
    auditValues.userIds = oldUserIds;
    await logAudit({
      userId: deleterId,
      action: "delete",
      entityType: "task",
      entityId: id,
      oldValues: auditValues,
    });

    scheduleTaskDeleted(oldTask as unknown as Parameters<typeof scheduleTaskDeleted>[0], oldUserIds, deleterId);
    schedulePushTaskDeleted(oldTask as unknown as Parameters<typeof schedulePushTaskDeleted>[0], oldUserIds, deleterId);

    // Scope cache: the former assignees may lose visibility of the
    // related project (if no other task of the project remains for them).
    invalidateScopeForUsers(oldUserIds);
  }

  // Cleanup content-addressable files (check reference counts)
  await cleanupTaskFilesContent(taskFiles);
  // Cleanup legacy task-specific folder
  await cleanupTaskFiles([id]);

  return task;
}

/**
 * Bulk delete tasks whose startDate is strictly before the given date.
 * Cleans up associated files (content-addressable + legacy folders) and
 * writes one aggregated audit entry. Used by Settings > Purge.
 */
export async function purgeTasksBefore(
  before: Date,
  purgerId?: string,
): Promise<{ deleted: number }> {
  const beforeIso = before.toISOString().slice(0, 10);

  const deletedRows = await db
    .delete(tasks)
    .where(lt(tasks.startDate, beforeIso))
    .returning({ id: tasks.id, files: tasks.files });

  for (const row of deletedRows) {
    const files = (row.files as { storageKey?: string; name?: string }[] | null) ?? [];
    await cleanupTaskFilesContent(files);
    await cleanupTaskFiles([row.id]);
  }

  await logAudit({
    userId: purgerId,
    action: "purge",
    entityType: "task",
    metadata: { before: beforeIso, count: deletedRows.length },
    changeCount: deletedRows.length,
  });

  return { deleted: deletedRows.length };
}

// Re-export move/resize/copy functions
export { moveTask, resizeTask, copyTask } from "./task-move-service";

// Re-export bulk/user functions
export { removeUserFromTask, bulkUpdateTasks, bulkDeleteTasks } from "./task-bulk-service";
