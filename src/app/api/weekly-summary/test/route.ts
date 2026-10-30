import { requireAuth, requirePermission, apiSuccess, apiError, handleApiError, AppError } from "@/lib/utils/api";
import { sendWeeklySummaryForUser } from "@/lib/services/weekly-summary-service";

export async function POST() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");

    const sent = await sendWeeklySummaryForUser(session.user.id);
    if (!sent) {
      // 200: not a failure, the client shows the message as a warning
      return apiError("notifications.errors.weeklyNoTasks", 200);
    }
    return apiSuccess({ success: true });
  } catch (error) {
    if (error instanceof AppError) return handleApiError(error);
    // Email provider error: its technical message is useful to the admin
    if (error instanceof Error && error.message) {
      return apiError("notifications.errors.sendFailed", 500, undefined, { reason: error.message });
    }
    return handleApiError(error);
  }
}
