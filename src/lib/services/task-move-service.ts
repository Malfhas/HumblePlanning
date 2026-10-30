import { db } from "@/db";
import { tasks, taskUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { MoveTask } from "@/lib/validators/task";
import { logAudit, pickAuditFields } from "./audit-service";
import { getTaskById } from "./task-service";
import { invalidateCachePrefix } from "@/lib/cache";

export async function moveTask(id: string, data: MoveTask, modifierId?: string) {
  const { userIds, ...moveData } = data;

  // Read old state for audit
  const oldTask = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });

  const updates: Record<string, unknown> = {
    startDate: moveData.startDate,
    lastModifierId: modifierId ?? undefined,
  };
  if (moveData.endDate) updates.endDate = moveData.endDate;
  if (moveData.startTime !== undefined) updates.startTime = moveData.startTime;
  if (moveData.endTime !== undefined) updates.endTime = moveData.endTime;
  if (moveData.projectId) updates.projectId = moveData.projectId;
  if (moveData.placeId) updates.placeId = moveData.placeId;
  if (moveData.resourceId) updates.resourceId = moveData.resourceId;

  const [task] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();

  if (!task) return null;

  // Update task_users if provided
  let oldUserIdsForScope: string[] | null = null;
  if (userIds !== undefined) {
    const oldRows = await db.select({ userId: taskUsers.userId }).from(taskUsers).where(eq(taskUsers.taskId, id));
    oldUserIdsForScope = oldRows.map((r) => r.userId);
    await db.delete(taskUsers).where(eq(taskUsers.taskId, id));
    if (userIds.length > 0) {
      await db.insert(taskUsers).values(
        userIds.map(userId => ({ taskId: id, userId }))
      );
    }
  }

  if (oldTask) {
    await logAudit({
      userId: modifierId,
      action: "move",
      entityType: "task",
      entityId: id,
      oldValues: { startDate: oldTask.startDate, endDate: oldTask.endDate, startTime: oldTask.startTime, endTime: oldTask.endTime },
      newValues: { startDate: moveData.startDate, endDate: moveData.endDate, startTime: moveData.startTime, endTime: moveData.endTime },
      metadata: { title: oldTask.title },
    });
  }

  // Scope cache: if the assignees changed, invalidate the affected users.
  if (userIds !== undefined && oldUserIdsForScope !== null) {
    const removed = oldUserIdsForScope.filter((uid) => !userIds.includes(uid));
    const added = userIds.filter((uid) => !oldUserIdsForScope!.includes(uid));
    for (const uid of [...removed, ...added]) invalidateCachePrefix(`scope:projects:${uid}:`);
  }

  // API contract consistency: return the full task with its relations
  // (project, status, users, etc.) instead of a raw row. Aligns move with
  // create/copy and ensures the MCP hook does not send a poor shape to the LLM.
  return getTaskById(id);
}

export async function resizeTask(id: string, data: { startDate?: string; endDate: string; startTime?: string; endTime?: string }, modifierId?: string) {
  // Read old state for audit
  const oldTask = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });

  const updates: Record<string, unknown> = {
    endDate: data.endDate,
    lastModifierId: modifierId ?? undefined,
  };
  if (data.startDate) updates.startDate = data.startDate;
  if (data.startTime !== undefined) updates.startTime = data.startTime;
  if (data.endTime !== undefined) updates.endTime = data.endTime;

  const [task] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();

  if (task && oldTask) {
    await logAudit({
      userId: modifierId,
      action: "resize",
      entityType: "task",
      entityId: id,
      oldValues: { startDate: oldTask.startDate, endDate: oldTask.endDate, startTime: oldTask.startTime, endTime: oldTask.endTime },
      newValues: { startDate: data.startDate, endDate: data.endDate, startTime: data.startTime, endTime: data.endTime },
      metadata: { title: oldTask.title },
    });
  }

  // Same as moveTask: return the "rich" version for the consistency of the API
  // contract (TaskWithUsers) consumed by the hooks and the MCP.
  return getTaskById(id);
}

export async function copyTask(
  id: string,
  data: { startDate: string; startTime?: string; endTime?: string; userIds?: string[]; projectId?: string; placeId?: string; resourceId?: string },
  creatorId?: string
) {
  const original = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: { taskUsers: true },
  });
  if (!original) return null;

  const { id: _, createdAt, updatedAt, taskUsers: originalTaskUsers, parentId, ...rest } = original;

  const daysDiff = original.endDate
    ? Math.round((new Date(data.startDate).getTime() - new Date(original.startDate).getTime()) / 86400000)
    : 0;
  const newEndDate = original.endDate
    ? new Date(new Date(original.endDate).getTime() + daysDiff * 86400000).toISOString().split("T")[0]
    : undefined;

  const [task] = await db.insert(tasks).values({
    ...rest,
    startDate: data.startDate,
    endDate: newEndDate,
    startTime: data.startTime ?? original.startTime,
    endTime: data.endTime ?? original.endTime,
    projectId: data.projectId ?? original.projectId,
    placeId: data.placeId ?? original.placeId ?? null,
    resourceId: data.resourceId ?? original.resourceId ?? null,
    creatorId: creatorId ?? undefined,
    lastModifierId: creatorId ?? undefined,
    isLocked: false,
  }).returning();

  // Copy or override user assignments
  const userIds = data.userIds ?? originalTaskUsers.map(tu => tu.userId);
  if (userIds.length > 0) {
    await db.insert(taskUsers).values(
      userIds.map(userId => ({ taskId: task.id, userId }))
    );
  }

  // Scope cache: the new assignees see the copied project in their
  // `assigned_only/own` scope → invalidate their scope:projects.
  for (const uid of userIds) invalidateCachePrefix(`scope:projects:${uid}:`);

  await logAudit({
    userId: creatorId,
    action: "copy",
    entityType: "task",
    entityId: task.id,
    newValues: { ...pickAuditFields(task as unknown as Record<string, unknown>, "task"), userIds },
    metadata: { sourceId: id },
  });

  // Return full task with all relations (project, users, status, etc.)
  // so the client can swap the optimistic placeholder without visual blink
  return getTaskById(task.id);
}
