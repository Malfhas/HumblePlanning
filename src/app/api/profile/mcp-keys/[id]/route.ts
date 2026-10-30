import { requireAuth, apiSuccess, handleApiError, AppError, assertUuid } from "@/lib/utils/api";
import { loadUserPermissions, hasPermission } from "@/lib/services/permission-service";
import { revokeMcpKey } from "@/lib/services/mcp-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "mcp:use")) throw new AppError("errors.forbidden");

    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await revokeMcpKey(session.user.id, id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
