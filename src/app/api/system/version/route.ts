import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVersionStatus } from "@/lib/services/update-check-service";

/**
 * Update status (Settings > Version, admin banner).
 * Contacts GitHub at most once every 24 h, and never if
 * UPDATE_CHECK_ENABLED=false. A network or GitHub error is returned
 * in `error` ("error" status), never as a 500.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");
    return apiSuccess(await getVersionStatus());
  } catch (error) {
    return handleApiError(error);
  }
}
