import { AppError, apiSuccess, getAuthSession, handleApiError } from "@/lib/utils/api";
import { crossOriginRejection, isSameOriginRequest } from "@/lib/utils/csrf";
import { getClientIp } from "@/lib/utils/rate-limit";
import { createPairingCode, getMobileSettings, isMobileSession, pairingLink } from "@/lib/services/mobile-service";
import { getConfigValue } from "@/lib/services/config-service";

/**
 * POST /api/mobile/pairing: creates the code of the QR shown on the web profile.
 * Whoever scans it signs in as this user, so only a page of the web site may
 * create one: a same-origin browser request, with a web session (no API key,
 * not the session of a mobile device).
 */
export async function POST(request: Request) {
  const rejected = await crossOriginRejection(request);
  if (rejected) return rejected;
  try {
    // An API key (or any bearer token); a proxy's Basic authentication is not one
    if (/^bearer\s/i.test(request.headers.get("authorization") ?? "")) throw new AppError("mobile.errors.webOnly", { status: 403 });
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");
    if (!isSameOriginRequest(request)) throw new AppError("errors.invalidOrigin", { status: 403 });
    if (await isMobileSession(session.session.id)) throw new AppError("mobile.errors.webOnly", { status: 403 });

    const { pairingEnabled } = await getMobileSettings();
    if (!pairingEnabled) throw new AppError("mobile.errors.pairingDisabled", { status: 403 });

    const baseUrl = (await getConfigValue("APP_BASE_URL")) || new URL(request.url).origin;
    const { code, expiresAt } = await createPairingCode(session.user.id, {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    return apiSuccess({ link: pairingLink(baseUrl, code), expiresAt }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
