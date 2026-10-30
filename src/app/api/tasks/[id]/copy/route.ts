import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { copyTask, assertDailyTaskLimit } from "@/lib/services/task-service";
import { copyTaskSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, canCreateTask } from "@/lib/services/permission-service";
import { db } from "@/db";
import { projects, tasks, taskUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const data = await validateBody(request, copyTaskSchema);

    // Resolve the effective userIds and projectId (override or reuse of the original)
    // to check the create right with the modify scope.
    const perms = await loadUserPermissions(session.user.id);
    const originalTask = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
      columns: { projectId: true },
    });
    if (!originalTask) return apiError("tasks.errors.notFound");

    const effectiveProjectId = data.projectId ?? originalTask.projectId;
    let effectiveUserIds = data.userIds ?? [];
    if (effectiveUserIds.length === 0) {
      const originalAssignees = await db
        .select({ userId: taskUsers.userId })
        .from(taskUsers)
        .where(eq(taskUsers.taskId, id));
      effectiveUserIds = originalAssignees.map((r) => r.userId);
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, effectiveProjectId),
      columns: { ownerId: true },
    });
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
