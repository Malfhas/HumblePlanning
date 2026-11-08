import { AppError, apiSuccess, getAuthSession, handleApiError, requireAuth } from "@/lib/utils/api";
import { listDevices } from "@/lib/services/mobile-service";

/** GET /api/mobile/devices: the user's signed-in devices, on the app or the web profile. */
export async function GET() {
  try {
    await requireAuth();
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");
    return apiSuccess(await listDevices(session.user.id, session.session.id));
  } catch (error) {
    return handleApiError(error);
  }
}
