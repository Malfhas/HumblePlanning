// What the server enforces on the mobile app. The app identifies itself with
// the `X-App-Version` header on every request; the web client never sends it.
import { AppError } from "@/lib/errors";
import { compareVersions, DEFAULT_MOBILE_STORE_URL, effectiveMinimumVersion } from "@/lib/utils/app-version";
import { getConfigValues } from "./config-service";
import { hasPermission, loadUserPermissions } from "./permission-service";

export const MOBILE_VERSION_HEADER = "x-app-version";
/** Role permission without which an account cannot use the mobile app (Super Admin: always). */
export const MOBILE_APP_PERMISSION = "mobile_app:use";

const CONFIG_KEYS = ["MOBILE_MIN_APP_VERSION", "MOBILE_STORE_URL", "MAINTENANCE_MODE"];

function isOn(value: string | null | undefined): boolean {
  return value === "true" || value === "1";
}

/**
 * Minimum version (the one of this release, or the setting when newer: an
 * update of the server raises it by itself), store page and maintenance state.
 */
export async function getMobileClientPolicy() {
  const config = await getConfigValues(CONFIG_KEYS);
  return {
    minimumVersion: effectiveMinimumVersion(config.MOBILE_MIN_APP_VERSION),
    storeUrl: config.MOBILE_STORE_URL?.trim() || DEFAULT_MOBILE_STORE_URL,
    maintenance: isOn(config.MAINTENANCE_MODE),
  };
}

/** 426 when the app that sent this request is older than the minimum version. */
export async function assertMobileAppVersion(headers: Headers): Promise<void> {
  const version = headers.get(MOBILE_VERSION_HEADER);
  if (!version) return;
  const { minimumVersion, storeUrl } = await getMobileClientPolicy();
  if (minimumVersion && compareVersions(version, minimumVersion) < 0) {
    throw new AppError("mobile.errors.upgradeRequired", { status: 426, params: { minimumVersion, storeUrl } });
  }
}

/** 403 when the role of this account does not allow the mobile app. */
export async function assertMobileAppPermission(userId: string): Promise<void> {
  if (!hasPermission(await loadUserPermissions(userId), MOBILE_APP_PERMISSION)) {
    throw new AppError("mobile.errors.appNotAllowed", { status: 403 });
  }
}

/**
 * Called by `requireAuth` for every authenticated request: refuses an app that
 * is too old (426), an account whose role does not allow the app (403, also
 * when the permission is withdrawn while the app is signed in) and, during
 * maintenance, an app whose user cannot bypass it (423). The web client
 * applies maintenance through its own guards.
 */
export async function assertMobileClientAllowed(headers: Headers, userId: string): Promise<void> {
  if (!headers.get(MOBILE_VERSION_HEADER)) return;
  await assertMobileAppVersion(headers);
  const perms = await loadUserPermissions(userId);
  if (!hasPermission(perms, MOBILE_APP_PERMISSION)) {
    throw new AppError("mobile.errors.appNotAllowed", { status: 403 });
  }
  const { maintenance } = await getMobileClientPolicy();
  if (maintenance && !hasPermission(perms, "maintenance:bypass")) {
    throw new AppError("mobile.errors.maintenance", { status: 423 });
  }
}
