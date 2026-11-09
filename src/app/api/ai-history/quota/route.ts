import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getAdminQuotaState } from "@/lib/ai-chat/quota-admin";

/**
 * AI history: usage of the current quota period per account, read only
 * (managed in Settings → AI). Only the accounts that used something.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:ai_history");
    const state = await getAdminQuotaState();
    return apiSuccess({ ...state, users: state.users.filter((user) => user.usageUsd > 0) });
  } catch (error) {
    return handleApiError(error);
  }
}
