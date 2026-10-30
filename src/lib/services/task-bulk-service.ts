import { db } from "@/db";
import { tasks, taskUsers } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit, computeChanges, pickAuditFields } from "./audit-service";
import { cleanupTaskFiles, cleanupTaskFilesContent } from "./task-service";
import { invalidateCachePrefix } from "@/lib/cache";

export async function removeUserFromTask(taskId: string, userId: string) {
  await db.delete(taskUsers)
    .where(and(eq(taskUsers.taskId, taskId), eq(taskUsers.userId, userId)));
  // The user just lost their assignment: their `assigned_only/own` scope
  // may no longer contain the related project.
  invalidateCachePrefix(`scope:projects:${userId}:`);
}

export async function bulkUpdateTasks(ids: string[], data: Record<string, unknown>, modifierId?: string) {
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
      data,
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
