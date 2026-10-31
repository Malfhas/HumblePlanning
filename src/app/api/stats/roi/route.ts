import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVisibleBusinessUnitIds } from "@/lib/services/permission-service";
import { getStatsRoi } from "@/lib/services/stats-service";

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "pages:stats_roi");
    const { searchParams } = new URL(request.url);
    const filters = {
      startDate: searchParams.get("startDate") || "2020-01-01",
      endDate: searchParams.get("endDate") || new Date().toISOString().split("T")[0],
      userIds: searchParams.get("userIds")?.split(",").filter(Boolean),
      teamIds: searchParams.get("teamIds")?.split(",").filter(Boolean),
      projectIds: searchParams.get("projectIds")?.split(",").filter(Boolean),
      laborTypeIds: searchParams.get("laborTypeIds")?.split(",").filter(Boolean),
      granularity: (searchParams.get("granularity") as any) || "month",
    };
    // Aggregates stay within the caller's business units (scope:bu_*)
    const data = await getStatsRoi(filters, getVisibleBusinessUnitIds(perms));
    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}
