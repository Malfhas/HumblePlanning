import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { copyTask, assertDailyTaskLimit } from "@/lib/services/task-service";
import { copyTaskSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, canCreateTask, assertTaskReadable, getReadableProject } from "@/lib/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const data = await validateBody(request, copyTaskSchema);

    // The source task must be readable (404 otherwise, like a missing task).
    const perms = await loadUserPermissions(session.user.id);
    const originalTask = await assertTaskReadable(perms, id);

    // Resolve the effective userIds and projectId (override or reuse of the original)
    // to check the create right with the modify scope.
    const effectiveProjectId = data.projectId ?? originalTask.projectId;
    let effectiveUserIds = data.userIds ?? [];
    if (effectiveUserIds.length === 0) {
      effectiveUserIds = originalTask.users.map((u) => u.id);
    }

    // Target project: outside the read scope it answers like a missing one.
    const project = effectiveProjectId ? await getReadableProject(perms, effectiveProjectId) : null;
    if (!project) return apiError("tasks.errors.projectNotFound", 404);

    const allowed = await canCreateTask(perms, effectiveUserIds, project.ownerId);
    if (!allowed) return apiError("tasks.errors.copyForbidden", 403);

    // PLANNING_MAX_TASKS_PER_DAY limit: block if the target day is already full
    try {
      await assertDailyTaskLimit({
        userIds: effectiveUserIds,
        startDate: data.startDate,
        endDate: null,
      });
    } catch (err) {
      return handleApiError(err);
    }

    const task = await copyTask(id, data, session.user.id);
    if (!task) return apiError("tasks.errors.notFound");
    emitTaskEvent({ action: "copied", taskId: task.id, userId: session.user.id });
    return apiSuccess(task, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
