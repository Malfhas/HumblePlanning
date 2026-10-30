import { requireAuth, requirePermission, apiSuccess, handleApiError, assertUuid } from "@/lib/utils/api";
import { deleteApiKey } from "@/lib/services/api-key-service";
import { logAudit } from "@/lib/services/audit-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await deleteApiKey(id);
    logAudit({
      userId: session.user.id,
      action: "api_key_delete",
      entityType: "api_key",
      entityId: id,
    }).catch(() => {});
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
