import { apiSuccess, handleApiError } from "@/lib/utils/api";
import { getConfigValues } from "@/lib/services/config-service";
import { getMobileSettings } from "@/lib/services/mobile-service";
import { getMobileClientPolicy } from "@/lib/services/mobile-client-policy";
import { isPushConfigured } from "@/lib/services/fcm-service";

/** Version of this API: raised on a breaking change, so an app can tell what it talks to. */
const MOBILE_API_VERSION = 1;

/**
 * GET /api/mobile/info (public): lets the app recognize a Humble Planning
 * server from its address and shows what it allows before sign-in. The server
 * version stays private (`/api/system/version`).
 */
export async function GET() {
  try {
    const [settings, policy, push, config] = await Promise.all([
      getMobileSettings(),
      getMobileClientPolicy(),
      isPushConfigured(),
      getConfigValues(["APP_TITLE", "APP_LOGO_LIGHT", "APP_LOGO_DARK", "FORGOT_PASSWORD_ENABLED", "MOBILE_PUSH_ENABLED"]),
    ]);
    return apiSuccess({
      service: "humble-planning",
      mobileApiVersion: MOBILE_API_VERSION,
      appTitle: config.APP_TITLE,
      logoLight: config.APP_LOGO_LIGHT,
      logoDark: config.APP_LOGO_DARK,
      loginEnabled: settings.loginEnabled,
      pairingEnabled: settings.pairingEnabled,
      pushEnabled: push,
      forgotPasswordEnabled: config.FORGOT_PASSWORD_ENABLED === "true",
      alertsEnabled: config.MOBILE_PUSH_ENABLED !== "false",
      maintenance: policy.maintenance,
      minimumAppVersion: policy.minimumVersion,
      storeUrl: policy.storeUrl,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
