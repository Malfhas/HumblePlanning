import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { deleteAllNotifications } from "@/lib/services/push-notification-service";

export async function DELETE() {
  try {
    const session = await requireAuth();
    await deleteAllNotifications(session.user.id);
    return apiSuccess({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
