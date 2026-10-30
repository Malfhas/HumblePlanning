import { requireAuth, requirePermission, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { purgeTasksBefore } from "@/lib/services/task-service";
import { taskPurgeSchema } from "@/lib/validators/task";

export async function DELETE(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");

    const body = await validateBody(request, taskPurgeSchema);
    const result = await purgeTasksBefore(new Date(body.before), session.user.id);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
