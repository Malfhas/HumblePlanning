import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { resizeTask, isTaskLocked } from "@/lib/services/task-service";
import { resizeTaskSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, hasPermission, assertTaskModifiable } from "@/lib/services/permission-service";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "tasks:resize")) {
      return apiError("errors.forbidden");
    }
    // 404 outside the read scope, 403 outside the modify scope
    await assertTaskModifiable(perms, id);
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
