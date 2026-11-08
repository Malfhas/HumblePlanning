import { AppError, apiSuccess, assertUuid, handleApiError, requireAuth } from "@/lib/utils/api";
import { revokeDevice } from "@/lib/services/mobile-service";
import { emitSessionRevoked } from "@/lib/socket-events";

/** DELETE /api/mobile/devices/{id}: signs one of the user's devices out. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    if (!await revokeDevice(session.user.id, id)) throw new AppError("mobile.errors.deviceNotFound", { status: 404 });
    emitSessionRevoked(session.user.id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
