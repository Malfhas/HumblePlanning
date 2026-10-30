import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getStatsUsers } from "@/lib/services/stats-service";

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:stats_users");
    const { searchParams } = new URL(request.url);
    const filters = {
      startDate: searchParams.get("startDate") || "2020-01-01",
      endDate: searchParams.get("endDate") || new Date().toISOString().split("T")[0],
      userIds: searchParams.get("userIds")?.split(",").filter(Boolean),
      teamIds: searchParams.get("teamIds")?.split(",").filter(Boolean),
      projectIds: searchParams.get("projectIds")?.split(",").filter(Boolean),
      laborTypeIds: searchParams.get("laborTypeIds")?.split(",").filter(Boolean),
      businessUnitIds: searchParams.get("businessUnitIds")?.split(",").filter(Boolean),
      granularity: (searchParams.get("granularity") as any) || "month",
      includeWeekends: searchParams.get("includeWeekends") === "true" ? true : searchParams.get("includeWeekends") === "false" ? false : undefined,
      includeHolidays: searchParams.get("includeHolidays") === "true" ? true : searchParams.get("includeHolidays") === "false" ? false : undefined,
    };
    const data = await getStatsUsers(filters);
    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}
