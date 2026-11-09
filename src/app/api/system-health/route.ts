import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getSystemOverview } from "@/lib/services/system-health-service";

/** System health: live state, configuration alerts, background tasks. */
export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:system_health");
    return apiSuccess(await getSystemOverview());
  } catch (error) {
    return handleApiError(error);
  }
}
