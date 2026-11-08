import { AppError, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { getClientIp } from "@/lib/utils/rate-limit";
import { parseSessionSetCookie } from "@/lib/utils/session-cookie";
import { mobileLoginSchema } from "@/lib/validators/mobile";
import { signInWithPassword } from "@/lib/services/password-login-service";
import {
  auditMobileAppRefusal,
  findAccountWithoutMobileApp,
  finishMobileSession,
  getLoginRequirements,
  getMobileSettings,
  MOBILE_IP_POLICY,
  mobileAppNotAllowed,
  mobileIpKey,
} from "@/lib/services/mobile-service";
import { assertMobileAppVersion } from "@/lib/services/mobile-client-policy";
import { lockedFor } from "@/lib/services/security-counter-service";

/**
 * POST /api/mobile/auth/login: password sign-in of the mobile app, with the
 * lockouts and audit of the web login but without its captcha, which a native
 * form cannot show. In exchange: an address lock across accounts, browsers are
 * refused (they always send `Origin` on a POST, so a bot cannot run this from
 * a page), and an administrator can turn it off (MOBILE_LOGIN_ENABLED).
 */
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin")) throw new AppError("errors.invalidOrigin", { status: 403 });
    await assertMobileAppVersion(request.headers);

    const { loginEnabled } = await getMobileSettings();
    if (!loginEnabled) throw new AppError("mobile.errors.loginDisabled", { status: 403 });

    const ip = getClientIp(request.headers);
    const ipKey = mobileIpKey(ip);
    const remaining = await lockedFor(ipKey);
    if (remaining > 0) {
      throw new AppError("auth.errors.tooManyAttemptsMinutes", { status: 429, params: { count: Math.ceil(remaining / 60) } });
    }

    const { identifier, password, device } = await validateBody(request, mobileLoginSchema);

    // An account whose role does not allow the app is refused before its
    // password is checked: this route must not tell whether it is right. Not a
    // failed attempt for the lockouts (no password was tried).
    const refusedUserId = await findAccountWithoutMobileApp(identifier);
    if (refusedUserId) {
      auditMobileAppRefusal(refusedUserId, { identifier, ip, userAgent: request.headers.get("user-agent") || "unknown" });
      throw mobileAppNotAllowed();
    }

    // The address lock is reserved and counted inside, with the per-account ones
    const response = await signInWithPassword(request, {
      identifier,
      password,
      rememberMe: true,
      mobile: { addressKey: ipKey, addressPolicy: MOBILE_IP_POLICY },
    });
    if (!response.ok) return response;

    const body = await response.clone().json() as { twoFactorRequired?: boolean; pendingToken?: string };
    if (body.twoFactorRequired) {
      return apiSuccess({ status: "two_factor_required", pendingToken: body.pendingToken });
    }

    const cookie = parseSessionSetCookie(response.headers.getSetCookie());
    if (!cookie) throw new AppError("errors.internal", { status: 500 });
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
