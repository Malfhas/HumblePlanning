import { requireAuth, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { loadUserPermissions } from "@/lib/services/permission-service";
import { cleanupMigration } from "@/lib/services/migration-service";

export async function DELETE() {
  try {
    const session = await requireAuth();
    // A migration creates accounts and assigns them roles: Super Admin only.
    const perms = await loadUserPermissions(session.user.id);
    if (!perms.isAdmin) throw new AppError("errors.forbidden");
    cleanupMigration();
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
