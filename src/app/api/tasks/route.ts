import { NextRequest } from "next/server";
import { requireAuth, validateBody, apiSuccess, apiSuccessCompressed, apiError, handleApiError, AppError } from "@/lib/utils/api";
import {
  loadUserPermissions,
  canCreateTask,
  hasPermission,
  getTaskAccessScope,
  getReadableProject,
} from "@/lib/services/permission-service";
import { getTasks, createTask, assertDailyTaskLimit } from "@/lib/services/task-service";
import { createTaskSchema, taskFiltersSchema } from "@/lib/validators/task";
import { emitTaskEvent } from "@/lib/socket-events";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "pages:tasks") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
      throw new AppError("errors.forbidden");
    }
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const filters = taskFiltersSchema.parse(params);

    // Apply role-based scope filtering in SQL (defense-in-depth on top of client filters)
    const result = await getTasks(filters, await getTaskAccessScope(perms));
    // Gzipped response because the payload can reach several tens of MB
    // on long ranges (`unpaginated=true` multi-month schedule).
    // Observed savings: ~10× on the wire (50 MB → 5 MB transfer).
    return apiSuccessCompressed(result, request);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const data = await validateBody(request, createTaskSchema);

    // Check granular create permission based on modifyScope + assigned users + project owner
    const perms = await loadUserPermissions(session.user.id);
    // Target project: outside the read scope it answers like a missing one.
    const project = await getReadableProject(perms, data.projectId);
    if (!project) return apiError("tasks.errors.projectNotFound", 404);
    const allowed = await canCreateTask(perms, data.userIds ?? [], project.ownerId);
    if (!allowed) {
      return apiError("tasks.errors.createForUsersForbidden", 403);
    }

    // PLANNING_MAX_TASKS_PER_DAY limit: block if at least one assignee
    // already reaches the limit on a day of the requested range.
    try {
      await assertDailyTaskLimit({
        userIds: data.userIds ?? [],
        startDate: data.startDate,
        endDate: data.endDate,
      });
    } catch (err) {
      return handleApiError(err);
    }

    const task = await createTask(data, session.user.id);
    emitTaskEvent({ action: "created", taskId: task.id, userId: session.user.id });
    return apiSuccess(task, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
