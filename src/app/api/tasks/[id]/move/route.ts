import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { moveTask, isTaskLocked, getTaskById, assertDailyTaskLimit } from "@/lib/services/task-service";
import { moveTaskSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";
import {
  loadUserPermissions,
  hasPermission,
  assertTaskModifiable,
  canAssignWithModifyScope,
  getReadableProject,
} from "@/lib/services/permission-service";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "tasks:move")) {
      return apiError("errors.forbidden");
    }
    const existingTask = await getTaskById(id);
    // 404 outside the read scope, 403 outside the modify scope
    await assertTaskModifiable(perms, existingTask);
    if (await isTaskLocked(id)) {
      return apiError("tasks.errors.locked", 403);
    }
    const data = await validateBody(request, moveTaskSchema);

    // If we actually reassign users or a project (values different
    // from the existing ones), the target state must respect modifyScope (same rule
    // as creation).
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
        return apiError("tasks.errors.moveOutOfScope", 403);
      }
    }

    // PLANNING_MAX_TASKS_PER_DAY limit: check before the move
    try {
      await assertDailyTaskLimit({
        userIds: Array.isArray(data.userIds) ? data.userIds : existingTask.users.map((u: { id: string }) => u.id),
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        excludeTaskId: id,
      });
    } catch (err) {
      return handleApiError(err);
    }

    const task = await moveTask(id, data, session.user.id);
    if (!task) return apiError("tasks.errors.notFound");
    emitTaskEvent({ action: "moved", taskId: id, userId: session.user.id });
    return apiSuccess(task);
  } catch (error) {
    return handleApiError(error);
  }
}
