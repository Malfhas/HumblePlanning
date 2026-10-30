import { requireAuth, requirePermission, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { purgeFilesBefore } from "@/lib/services/file-service";
import { filePurgeSchema } from "@/lib/validators/file";

export async function DELETE(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");

    const body = await validateBody(request, filePurgeSchema);
    const result = await purgeFilesBefore(new Date(body.before));
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
