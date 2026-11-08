import { AppError, apiSuccess, getAuthSession, handleApiError } from "@/lib/utils/api";
import { crossOriginRejection } from "@/lib/utils/csrf";
import { createPairingCode, getMobileSettings, pairingLink } from "@/lib/services/mobile-service";
import { getConfigValue } from "@/lib/services/config-service";

/**
 * POST /api/mobile/pairing: creates the code of the QR shown on the web profile.
 * A browser session only (no API key): whoever scans it signs in as this user.
 */
export async function POST(request: Request) {
  const rejected = await crossOriginRejection(request);
  if (rejected) return rejected;
  try {
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");

    const { pairingEnabled } = await getMobileSettings();
    if (!pairingEnabled) throw new AppError("mobile.errors.pairingDisabled", { status: 403 });

    const baseUrl = (await getConfigValue("APP_BASE_URL")) || new URL(request.url).origin;
    const { code, expiresAt } = await createPairingCode(session.user.id);
    return apiSuccess({ link: pairingLink(baseUrl, code), expiresAt }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
