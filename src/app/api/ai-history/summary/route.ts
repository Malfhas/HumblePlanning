import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getAiHistorySummary } from "@/lib/services/ai-history-service";
import { aiHistoryFiltersSchema, parseQuery } from "@/lib/validators/system-health";
import { periodSince } from "@/lib/system-health/retention";

/** AI history: indicators and cost per day, same filters as the list. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:ai_history");
    const { days, userIds, models } = parseQuery(aiHistoryFiltersSchema, request.nextUrl.searchParams);
    return apiSuccess(await getAiHistorySummary({ since: periodSince(new Date(), days), userIds, models }));
  } catch (error) {
    return handleApiError(error);
  }
}
