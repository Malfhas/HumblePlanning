import { requireAuth, handleApiError, apiSuccess } from "@/lib/utils/api";
import { markAllAsRead } from "@/lib/services/push-notification-service";

export async function PATCH() {
  try {
    const session = await requireAuth();
    await markAllAsRead(session.user.id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
