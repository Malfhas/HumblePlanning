import { requireAuth, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { removeUserFromTask, isTaskLocked } from "@/lib/services/task-service";
import { removeUserFromRecurringTasks } from "@/lib/services/recurring-task-service";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, hasPermission, assertTaskModifiable } from "@/lib/services/permission-service";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "tasks:assign")) {
      return apiError("errors.forbidden");
    }
    const { id, userId } = await params;
    assertUuid(id);
    assertUuid(userId);
    // 404 outside the read scope, 403 outside the modify scope
    await assertTaskModifiable(perms, id);
    // A lock freezes the assignees too (PUT /api/tasks/[id] refuses the change)
    if (await isTaskLocked(id)) {
      return apiError("tasks.errors.locked", 403);
    }
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") as "single" | "all" | "after" | null;

    if (scope && scope !== "single") {
      // Only reaches the other occurrences this user could modify one by one
      const result = await removeUserFromRecurringTasks(id, userId, scope, perms);
      emitTaskEvent({ action: "updated", taskId: id, userId: session.user.id });
      return apiSuccess(result);
    }

    await removeUserFromTask(id, userId);
    emitTaskEvent({ action: "updated", taskId: id, userId: session.user.id });
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
