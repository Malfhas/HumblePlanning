import { requireAuth, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { loadUserPermissions } from "@/lib/services/permission-service";
import { cleanupImport } from "@/lib/services/import-service";
import { refuseInDemo } from "@/lib/demo/guard";

export async function DELETE(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    // A replace-mode import rewrites roles and accounts: Super Admin only
    // (`backups:create` alone would amount to it).
    const perms = await loadUserPermissions(session.user.id);
    if (!perms.isAdmin) throw new AppError("errors.forbidden");
    await cleanupImport();
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
