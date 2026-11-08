import { AppError, apiSuccess, handleApiError, requireAuth } from "@/lib/utils/api";
import { isPushConfigured } from "@/lib/services/fcm-service";
import { sendMobileTestAlert } from "@/lib/services/mobile-alert-service";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, translateKey } from "@/i18n/server-translator";

/** POST /api/mobile/devices/current/push-test: sends a test alert to the user's devices. */
export async function POST() {
  try {
    const session = await requireAuth();
    if (!await isPushConfigured()) throw new AppError("mobile.errors.pushNotConfigured", { status: 503 });
    const t = await getServerTranslator(await resolveRequestLocale());
    const delivered = await sendMobileTestAlert(
      session.user.id,
      translateKey(t, "mobile.pushTest.title") ?? "Humble Planning",
      translateKey(t, "mobile.pushTest.message") ?? "",
    );
    return apiSuccess({ delivered });
  } catch (error) {
    return handleApiError(error);
  }
}
