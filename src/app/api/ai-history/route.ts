import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { listAiConversations } from "@/lib/services/ai-history-service";
import { aiHistoryListSchema, parseQuery } from "@/lib/validators/system-health";
import { periodSince } from "@/lib/system-health/retention";

/** AI history: conversations of the period (server pagination), deleted ones included. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:ai_history");
    const { days, userIds, models, page, limit } = parseQuery(aiHistoryListSchema, request.nextUrl.searchParams);
    return apiSuccess(await listAiConversations({ since: periodSince(new Date(), days), userIds, models }, page, limit));
  } catch (error) {
    return handleApiError(error);
  }
}
