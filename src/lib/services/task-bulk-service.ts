import { db } from "@/db";
import { tasks, taskUsers } from "@/db/schema";
import { eq, and, inArray, type SQL } from "drizzle-orm";
import { logAudit, computeChanges, pickAuditFields } from "./audit-service";
import { cleanupTaskFiles, cleanupTaskFilesContent } from "./task-service";
import {
  canModifyTask,
  canAssignWithModifyScope,
  getTaskAccessScope,
  getReadableProject,
  isTaskInAccessScope,
  type TaskAccessScope,
  type UserPermissions,
} from "./permission-service";
import { invalidateCachePrefix } from "@/lib/cache";
import { AppError } from "@/lib/errors";

export type BulkTaskAction = "update" | "delete";

/** Fields a bulk update may change; anything else goes through PUT /api/tasks/[id]. */
export interface BulkTaskUpdate {
  statusId?: string;
  projectId?: string;
}

/** What the permission checks need to know about a task targeted by a bulk operation. */
export interface BulkTaskTarget {
  id: string;
  projectId: string;
  isLocked: boolean;
  creatorId: string | null;
  projectOwnerId: string | null;
  users: { id: string; teamId: string | null }[];
}

/**
 * Error code refusing `action` on `task`, or null. Same rules as
 * PUT/DELETE /api/tasks/[id]: read scope (`readScope`, from
 * `getTaskAccessScope`; outside it the task answers like a missing one), then
 * modify scope, then the lock. A bulk update never carries a lock change, so a
 * locked task is always refused.
 */
export function bulkTaskViolation(
  perms: UserPermissions,
  task: BulkTaskTarget,
  action: BulkTaskAction,
  readScope: TaskAccessScope,
): string | null {
  if (!isTaskInAccessScope(task, readScope)) return "tasks.errors.notFound";
  if (!canModifyTask(perms, task, readScope)) {
    return action === "delete" ? "tasks.errors.deleteNotAllowed" : "tasks.errors.notAllowed";
  }
  if (task.isLocked) return "tasks.errors.locked";
  return null;
}

/** Loads the `BulkTaskTarget` fields of the tasks matching `where`, in one query. */
export async function loadBulkTaskTargets(where: SQL | undefined): Promise<BulkTaskTarget[]> {
  const rows = await db.query.tasks.findMany({
    where,
    columns: { id: true, projectId: true, isLocked: true, creatorId: true },
    with: {
      project: { columns: { ownerId: true } },
      taskUsers: { with: { user: { columns: { id: true, teamId: true } } } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    isLocked: t.isLocked,
    creatorId: t.creatorId,
    projectOwnerId: t.project?.ownerId ?? null,
    users: t.taskUsers.map((tu) => tu.user).filter(Boolean),
  }));
}

/**
 * Throws unless `perms` may apply `action` to every task of `ids`: the whole
 * request is refused as soon as one task is missing or not allowed.
 * The action permission itself (`tasks:delete`) is checked by the caller.
 */
export async function assertBulkTasksAllowed(
  perms: UserPermissions,
  ids: string[],
  action: BulkTaskAction,
  data: BulkTaskUpdate = {},
) {
  const targets = await loadBulkTaskTargets(inArray(tasks.id, ids));
  if (targets.length !== new Set(ids).size) throw new AppError("tasks.errors.notFound");

  const readScope = await getTaskAccessScope(perms);
  for (const task of targets) {
    const code = bulkTaskViolation(perms, task, action, readScope);
    if (code) throw new AppError(code, { status: code === "tasks.errors.notFound" ? 404 : 403 });
  }

  // Moving tasks to another project: as in PUT /api/tasks/[id], the target
  // project must be readable and the target state must respect the user's
  // scope:modify_*.
  if (action === "update" && data.projectId) {
    const project = await getReadableProject(perms, data.projectId);
    if (!project) throw new AppError("tasks.errors.projectNotFound", { status: 404 });
    if (!perms.isAdmin) {
      for (const task of targets) {
        if (task.projectId === data.projectId) continue;
        const allowed = await canAssignWithModifyScope(perms, task.users.map((u) => u.id), project.ownerId);
        if (!allowed) throw new AppError("tasks.errors.updateOutOfScope", { status: 403 });
      }
    }
  }
}

export async function removeUserFromTask(taskId: string, userId: string) {
  await db.delete(taskUsers)
    .where(and(eq(taskUsers.taskId, taskId), eq(taskUsers.userId, userId)));
  // The user just lost their assignment: their `assigned_only/own` scope
  // may no longer contain the related project.
  invalidateCachePrefix(`scope:projects:${userId}:`);
}

export async function bulkUpdateTasks(ids: string[], data: BulkTaskUpdate, modifierId?: string) {
  if (ids.length === 0) return [];

  // Read old states for audit
  const oldTasks = await db.query.tasks.findMany({ where: inArray(tasks.id, ids) });

  const result = await db
    .update(tasks)
    .set({ ...data, lastModifierId: modifierId ?? undefined })
    .where(inArray(tasks.id, ids))
    .returning();

  // Log one audit entry per task
  for (const oldTask of oldTasks) {
    const changes = computeChanges(
      oldTask as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
      "task"
    );
    if (changes) {
      await logAudit({
        userId: modifierId,
        action: "update",
        entityType: "task",
        entityId: oldTask.id,
        oldValues: changes.old,
        newValues: changes.new,
        changeCount: changes.count,
      });
    }
  }

  // Scope cache: a bulk operation can affect visible projects → broad flush.
  invalidateCachePrefix("scope:projects:");

  return result;
}

export async function bulkDeleteTasks(ids: string[], deleterId?: string) {
  if (ids.length === 0) return [];

  // Read old states + user assignments for audit
  const oldTasks = await db.query.tasks.findMany({ where: inArray(tasks.id, ids) });
  const oldUserRows = await db.select().from(taskUsers).where(inArray(taskUsers.taskId, ids));

  const result = await db
    .delete(tasks)
    .where(inArray(tasks.id, ids))
    .returning();

  // Log one audit entry per task
  for (const oldTask of oldTasks) {
    const auditValues = pickAuditFields(oldTask as unknown as Record<string, unknown>, "task", true);
    auditValues.userIds = oldUserRows.filter(r => r.taskId === oldTask.id).map(r => r.userId);
    await logAudit({
      userId: deleterId,
      action: "delete",
      entityType: "task",
      entityId: oldTask.id,
      oldValues: auditValues,
    });
  }

  // Cleanup content-addressable files (check reference counts)
  const allTaskFiles = oldTasks.flatMap(t => (t.files as { storageKey?: string; name?: string }[] ?? []));
  await cleanupTaskFilesContent(allTaskFiles);
  // Cleanup legacy task-specific folders
  await cleanupTaskFiles(ids);

  // Scope cache: mass deletion → broad flush of scope:projects.
  invalidateCachePrefix("scope:projects:");

  return result;
}
