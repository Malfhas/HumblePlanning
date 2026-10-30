import { requireAuth, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { bulkUpdateTasks, bulkDeleteTasks } from "@/lib/services/task-service";
import { z } from "zod";
import { emitTaskEvent } from "@/lib/socket-events";
import { loadUserPermissions, getModifyScope, hasPermission } from "@/lib/services/permission-service";

const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum(["update", "delete"]),
  data: z.record(z.string(), z.unknown()).optional(),
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
      const result = await bulkDeleteTasks(body.ids, session.user.id);
      emitTaskEvent({ action: "bulk-deleted", taskIds: body.ids, userId: session.user.id });
      return apiSuccess({ deleted: result.length });
    }

    if (body.action === "update" && body.data) {
      const result = await bulkUpdateTasks(body.ids, body.data, session.user.id);
      emitTaskEvent({ action: "bulk-updated", taskIds: body.ids, userId: session.user.id });
      return apiSuccess({ updated: result.length });
    }

    return apiSuccess({ updated: 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
