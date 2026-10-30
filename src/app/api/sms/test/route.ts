import { requireAuth, requirePermission, apiSuccess, apiError, handleApiError, AppError } from "@/lib/utils/api";
import { testSentConnection } from "@/lib/services/sent-service";

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");

    let to: string | undefined;
    try {
      const body = await request.json();
      to = body.to || undefined;
    } catch {
      // No body or invalid JSON
    }

    if (!to) {
      return apiError("notifications.errors.phoneRequired");
    }

    await testSentConnection(to);
    return apiSuccess({ success: true });
  } catch (error) {
    if (error instanceof AppError) return handleApiError(error);
    // Sent.dm API error: its technical message is useful to the admin
    if (error instanceof Error && error.message) {
      return apiError("notifications.errors.sendFailed", 500, undefined, { reason: error.message });
    }
    return handleApiError(error);
  }
}
