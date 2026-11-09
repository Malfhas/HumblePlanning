import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getAiHistoryFilterOptions } from "@/lib/services/ai-history-service";

/** AI history: users and models present in the history (filter values). */
export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:ai_history");
    return apiSuccess(await getAiHistoryFilterOptions());
  } catch (error) {
    return handleApiError(error);
  }
}
