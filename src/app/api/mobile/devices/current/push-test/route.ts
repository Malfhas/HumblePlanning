import { AppError, apiSuccess, getAuthSession, handleApiError, requireAuth } from "@/lib/utils/api";
import { isPushConfigured } from "@/lib/services/fcm-service";
import { sendMobileTestAlert } from "@/lib/services/mobile-alert-service";
import { assertMobileAppPermission } from "@/lib/services/mobile-client-policy";
import { checkPersistentRateLimit } from "@/lib/services/security-counter-service";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, translateKey } from "@/i18n/server-translator";

/** Test pushes per user: each one reaches Firebase or the relay for every device. */
const PUSH_TEST_MAX = 5;
const PUSH_TEST_WINDOW_MS = 10 * 60 * 1000;

/** POST /api/mobile/devices/current/push-test: sends a test alert to the user's devices. */
export async function POST() {
  try {
    await requireAuth();
    // A session of the user, not an API key
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");
    await assertMobileAppPermission(session.user.id);
    if (!await isPushConfigured()) throw new AppError("mobile.errors.pushNotConfigured", { status: 503 });
    if (!await checkPersistentRateLimit(`mobile-push-test:user:${session.user.id}`, PUSH_TEST_MAX, PUSH_TEST_WINDOW_MS)) {
      throw new AppError("errors.rateLimited");
    }
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
