import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { loadUserPermissions } from "@/lib/services/permission-service";

/**
 * GET /api/auth/permissions
 * Returns the current user's permissions. Auth-only, no permission required.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    return apiSuccess({
      permissions: perms.permissions,
      isAdmin: perms.isAdmin,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
