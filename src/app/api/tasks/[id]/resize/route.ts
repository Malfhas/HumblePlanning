import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { resizeTask, isTaskLocked, getTaskById } from "@/lib/services/task-service";
import { resizeTaskSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, hasPermission, canModifyTask } from "@/lib/services/permission-service";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "tasks:resize")) {
      return apiError("errors.forbidden");
    }
    const existingTask = await getTaskById(id);
    if (!existingTask) return apiError("tasks.errors.notFound");
    if (!canModifyTask(perms, {
      users: existingTask.users,
      creatorId: existingTask.creatorId,
      projectOwnerId: existingTask.project?.ownerId,
    })) {
      return apiError("tasks.errors.notAllowed");
    }
    if (await isTaskLocked(id)) {
      return apiError("tasks.errors.locked", 403);
    }
    const data = await validateBody(request, resizeTaskSchema);
    const task = await resizeTask(id, data, session.user.id);
    if (!task) return apiError("tasks.errors.notFound");
    emitTaskEvent({ action: "resized", taskId: id, userId: session.user.id });
    return apiSuccess(task);
  } catch (error) {
    return handleApiError(error);
  }
}
