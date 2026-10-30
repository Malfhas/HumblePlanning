import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getStatsRoi } from "@/lib/services/stats-service";

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:stats_roi");
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
    const data = await getStatsRoi(filters);
    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}
