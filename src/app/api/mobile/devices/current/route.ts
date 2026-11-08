import { AppError, apiSuccess, getAuthSession, handleApiError, requireAuth, validateBody } from "@/lib/utils/api";
import { updateCurrentDevice } from "@/lib/services/mobile-service";
import { MOBILE_VERSION_HEADER } from "@/lib/services/mobile-client-policy";
import { updateMobileDeviceSchema } from "@/lib/validators/mobile";

/**
 * PUT /api/mobile/devices/current: name, app version, language and push token
 * of this device (`pushToken: null` stops its push notifications). Only the
 * app, which sends `X-App-Version` on every request, registers a device: a
 * browser session must not appear as one (nor receive mobile alerts).
 */
export async function PUT(request: Request) {
  try {
    await requireAuth();
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");
    if (!request.headers.get(MOBILE_VERSION_HEADER)) throw new AppError("mobile.errors.appOnly", { status: 403 });
    const data = await validateBody(request, updateMobileDeviceSchema);
    return apiSuccess(await updateCurrentDevice(session.user.id, session.session.id, data));
  } catch (error) {
    return handleApiError(error);
  }
}
