import { requireAuth, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { assertBulkTasksAllowed, bulkUpdateTasks, bulkDeleteTasks } from "@/lib/services/task-bulk-service";
import { uuidSchema } from "@/lib/validators/common";
import { z } from "zod";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, getModifyScope, hasPermission } from "@/lib/services/permission-service";

const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum(["update", "delete"]),
  // Strict: a bulk update may only change the status or the project. Any
  // other column (creator, lock, files…) is rejected, not silently written.
  data: z.strictObject({
    statusId: uuidSchema.optional(),
    projectId: uuidSchema.optional(),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    // Bulk ops require a modify scope above readonly
    if (getModifyScope(perms) === "readonly") {
      return apiError("errors.forbidden");
    }
    const body = await validateBody(request, bulkUpdateSchema);

    if (body.action === "delete") {
      if (!hasPermission(perms, "tasks:delete")) {
        return apiError("errors.forbidden");
      }
      await assertBulkTasksAllowed(perms, body.ids, "delete");
      const result = await bulkDeleteTasks(body.ids, session.user.id);
      emitTaskEvent({ action: "bulk-deleted", taskIds: body.ids, userId: session.user.id });
      return apiSuccess({ deleted: result.length });
    }

    if (body.action === "update" && body.data && Object.keys(body.data).length > 0) {
      await assertBulkTasksAllowed(perms, body.ids, "update", body.data);
      const result = await bulkUpdateTasks(body.ids, body.data, session.user.id);
      emitTaskEvent({ action: "bulk-updated", taskIds: body.ids, userId: session.user.id });
      return apiSuccess({ updated: result.length });
    }

    return apiSuccess({ updated: 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
