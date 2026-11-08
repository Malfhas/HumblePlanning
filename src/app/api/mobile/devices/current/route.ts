import { AppError, apiSuccess, getAuthSession, handleApiError, requireAuth, validateBody } from "@/lib/utils/api";
import { updateCurrentDevice } from "@/lib/services/mobile-service";
import { updateMobileDeviceSchema } from "@/lib/validators/mobile";

/**
 * PUT /api/mobile/devices/current: name, app version, language and push token
 * of this device (`pushToken: null` stops its push notifications).
 */
export async function PUT(request: Request) {
  try {
    await requireAuth();
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");
    const data = await validateBody(request, updateMobileDeviceSchema);
    return apiSuccess(await updateCurrentDevice(session.user.id, session.session.id, data));
  } catch (error) {
    return handleApiError(error);
  }
}
