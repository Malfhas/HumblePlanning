import { requireAuth, handleApiError, apiSuccess, assertUuid } from "@/lib/utils/api";
import { markAsRead, deleteNotification } from "@/lib/services/push-notification-service";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await markAsRead(session.user.id, id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await deleteNotification(session.user.id, id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
