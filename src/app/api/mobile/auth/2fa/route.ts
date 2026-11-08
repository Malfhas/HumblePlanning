import { AppError, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { parseSessionSetCookie } from "@/lib/utils/session-cookie";
import { mobileTwoFactorSchema } from "@/lib/validators/mobile";
import { verifySecondFactor } from "@/lib/services/two-factor-login-service";
import { finishMobileSession, getLoginRequirements } from "@/lib/services/mobile-service";
import { assertMobileAppVersion } from "@/lib/services/mobile-client-policy";

/** POST /api/mobile/auth/2fa: second step of the mobile sign-in, same checks as the web one. */
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin")) throw new AppError("errors.invalidOrigin", { status: 403 });
    await assertMobileAppVersion(request.headers);

    const { pendingToken, code, isBackupCode, device } = await validateBody(request, mobileTwoFactorSchema);
    const verification = new Request(request.url, {
      method: "POST",
      body: JSON.stringify({ pendingToken, code, isBackupCode }),
    });
    const response = await verifySecondFactor(verification);

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
