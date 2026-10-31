import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, AppError, assertUuid } from "@/lib/utils/api";
import { getTaskById, updateTask, deleteTask, isTaskLocked, assertDailyTaskLimit } from "@/lib/services/task-service";
import { updateTaskSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";
import { assertTaskResourceWritable } from "@/lib/services/equipment-scope";
import { deleteRecurringTasks, propagateTaskUpdate, getRootTaskId } from "@/lib/services/recurring-task-service";
import {
  loadUserPermissions,
  hasPermission,
  canModifyTask,
  canAssignWithModifyScope,
  getTaskAccessScope,
  isTaskInAccessScope,
  assertTaskReadable,
  assertTaskModifiable,
  getReadableProject,
} from "@/lib/services/permission-service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "pages:tasks") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
      throw new AppError("errors.forbidden");
    }
    const { id } = await params;
    assertUuid(id);
    const task = await getTaskById(id);
    // Same scope as the list: an out-of-scope task returns 404, like
    // a non-existent task (we do not reveal its existence).
    if (!task || !isTaskInAccessScope(task, await getTaskAccessScope(perms))) {
      return apiError("tasks.errors.notFound");
    }
    return apiSuccess(task);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    const existingTask = await getTaskById(id);
    // 404 outside the read scope, 403 outside the modify scope
    await assertTaskModifiable(perms, existingTask);
    const url = new URL(request.url);
    const applyToAll = url.searchParams.get("applyToAll") === "true";
    const data = await validateBody(request, updateTaskSchema);

    // Locking needs `tasks:lock` (client: canLockTask). A locked task can only
    // be changed together with a lock toggle, hence only by someone allowed to lock.
    const includesLockChange = data.isLocked !== undefined;
    if (includesLockChange && !hasPermission(perms, "tasks:lock")) {
      return apiError("tasks.errors.insufficientPermission", 403);
    }
    if (!includesLockChange && await isTaskLocked(id)) {
      return apiError("tasks.errors.locked", 403);
    }

    // If the request actually changes the assignees or the project (values
    // different from the existing ones), the target state must respect the
    // user's scope:modify_*. `userIds` / `projectId` may be
    // present in the payload without having changed — we compare to the existing.
    const existingUserIds = existingTask.users.map((u: { id: string }) => u.id);
    const payloadUserIds = Array.isArray(data.userIds) ? [...data.userIds].sort() : null;
    const usersChanged = payloadUserIds !== null
      && JSON.stringify(payloadUserIds) !== JSON.stringify([...existingUserIds].sort());
    const projectChanged = typeof data.projectId === "string"
      && data.projectId !== existingTask.projectId;

    if (!perms.isAdmin && (usersChanged || projectChanged)) {
      if (usersChanged && !hasPermission(perms, "tasks:assign")) {
        return apiError("tasks.errors.assignForbidden", 403);
      }
      const targetUserIds = usersChanged ? (data.userIds as string[]) : existingUserIds;
      let targetProjectOwnerId: string | null = existingTask.project?.ownerId ?? null;
      if (projectChanged) {
        // Target project: outside the read scope it answers like a missing one.
        const newProject = await getReadableProject(perms, data.projectId!);
        if (!newProject) return apiError("tasks.errors.projectNotFound", 404);
        targetProjectOwnerId = newProject.ownerId;
      }
      const allowed = await canAssignWithModifyScope(perms, targetUserIds, targetProjectOwnerId);
      if (!allowed) {
        return apiError("tasks.errors.updateOutOfScope", 403);
      }
    }
    // A new resource: one of the user's business units (404 otherwise)
    await assertTaskResourceWritable(perms, data.resourceId, existingTask.resourceId);

    // PLANNING_MAX_TASKS_PER_DAY limit: if the assignees or the dates
    // change, check that no day exceeds the limit for the
    // targeted users. The current task is excluded from the count.
    const datesChanged =
      (typeof data.startDate === "string" && data.startDate !== existingTask.startDate) ||
      ("endDate" in data && data.endDate !== existingTask.endDate);
    if (usersChanged || datesChanged) {
      const targetUserIds = usersChanged ? (data.userIds as string[]) : existingUserIds;
      const targetStart = (typeof data.startDate === "string" ? data.startDate : existingTask.startDate) as string;
      const targetEnd = "endDate" in data ? (data.endDate as string | null | undefined) : existingTask.endDate;
      try {
        await assertDailyTaskLimit({
          userIds: targetUserIds,
          startDate: targetStart,
          endDate: targetEnd,
          excludeTaskId: id,
        });
      } catch (err) {
        return handleApiError(err);
      }
    }

    const task = await updateTask(id, data, session.user.id);
    if (!task) return apiError("tasks.errors.notFound");

    if (applyToAll) {
      // Only reaches the other occurrences this user could update one by one
      const rootId = await getRootTaskId(id);
      await propagateTaskUpdate(rootId, data, perms);
    }

    emitTaskEvent({ action: "updated", taskId: id, userId: session.user.id });
    return apiSuccess(task);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "tasks:delete")) {
      return apiError("errors.forbidden");
    }
    const existingTask = await getTaskById(id);
    await assertTaskReadable(perms, existingTask);
    if (!canModifyTask(perms, existingTask, await getTaskAccessScope(perms))) {
      return apiError("tasks.errors.deleteNotAllowed", 403);
    }
    if (await isTaskLocked(id)) {
      return apiError("tasks.errors.locked", 403);
    }

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") as "single" | "all" | "before" | "after" | null;

    if (scope && scope !== "single") {
      // Only deletes the occurrences this user could delete one by one
      const result = await deleteRecurringTasks(id, scope, perms);
      emitTaskEvent({ action: "deleted", taskId: id });
      return apiSuccess(result);
    }

    const task = await deleteTask(id, session.user.id);
    if (!task) return apiError("tasks.errors.notFound");
    emitTaskEvent({ action: "deleted", taskId: id });
    return apiSuccess(task);
  } catch (error) {
    return handleApiError(error);
  }
}
