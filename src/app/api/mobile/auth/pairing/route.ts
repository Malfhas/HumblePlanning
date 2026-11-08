import { AppError, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { getClientIp } from "@/lib/utils/rate-limit";
import { mobilePairingSchema } from "@/lib/validators/mobile";
import {
  finishMobileSession,
  getLoginRequirements,
  getMobileSettings,
  MOBILE_IP_POLICY,
  mobileIpKey,
  redeemPairingCode,
} from "@/lib/services/mobile-service";
import { assertMobileAppVersion } from "@/lib/services/mobile-client-policy";
import { failAttempt, lockedFor, releaseAttempt, reserveAttempt } from "@/lib/services/security-counter-service";

/** POST /api/mobile/auth/pairing: signs the app in with the code of a QR shown on the web profile. */
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin")) throw new AppError("errors.invalidOrigin", { status: 403 });
    await assertMobileAppVersion(request.headers);

    const { pairingEnabled } = await getMobileSettings();
    if (!pairingEnabled) throw new AppError("mobile.errors.pairingDisabled", { status: 403 });

    const ip = getClientIp(request.headers);
    const ipKey = mobileIpKey(ip);
    const remaining = await lockedFor(ipKey);
    if (remaining > 0) {
      throw new AppError("auth.errors.tooManyAttemptsMinutes", { status: 429, params: { count: Math.ceil(remaining / 60) } });
    }

    const { code, device } = await validateBody(request, mobilePairingSchema);
    // Reserved before the code is checked, like a password attempt; only a rejected code counts
    const attempt = await reserveAttempt(ipKey, MOBILE_IP_POLICY);
    if (attempt.lockedSeconds > 0) {
      throw new AppError("auth.errors.tooManyAttemptsMinutes", { status: 429, params: { count: Math.ceil(attempt.lockedSeconds / 60) } });
    }
    const cookie = await redeemPairingCode(code, ip, request.headers.get("user-agent")).catch(async (error: unknown) => {
      // A valid code of a role without the app (403): not a guess
      await releaseAttempt(attempt);
      throw error;
    });
    if (!cookie) {
      await failAttempt(attempt);
      throw new AppError("mobile.errors.invalidPairingCode", { status: 401 });
    }
    await releaseAttempt(attempt);

    const session = await finishMobileSession(cookie, device);
    return apiSuccess({
      status: "authenticated",
      session,
      ...await getLoginRequirements(session.userId),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
