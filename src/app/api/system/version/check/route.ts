import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVersionStatus } from "@/lib/services/update-check-service";

/**
 * "Check now": forces a check, without waiting for the 24 h.
 * No effect (no outgoing request) if UPDATE_CHECK_ENABLED=false.
 */
export async function POST() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    return apiSuccess(await getVersionStatus({ force: true }));
  } catch (error) {
    return handleApiError(error);
  }
}
