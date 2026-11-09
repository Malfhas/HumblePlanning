// The platforms of the native apps and what the server does differently for each.
import { DEFAULT_MOBILE_STORE_URL } from "./app-version";

export const MOBILE_PLATFORMS = ["android", "ios"] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

/** Sent by the iOS app on every request, next to `X-App-Version`; the Android app (1.0.x) sends none. */
export const MOBILE_PLATFORM_HEADER = "x-app-platform";

/** The platform of the app that sent a request: iOS when it says so, Android otherwise. */
export function mobilePlatformOf(headers: Headers): MobilePlatform {
  return headers.get(MOBILE_PLATFORM_HEADER)?.trim().toLowerCase() === "ios" ? "ios" : "android";
}

/** Platforms whose devices get push: through Firebase, Android only until push through Apple's APNs exists. */
export const PUSH_PLATFORMS: readonly MobilePlatform[] = ["android"];

export function hasPush(platform: string): boolean {
  return (PUSH_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * Download page an outdated app is sent to, from the setting of its platform.
 * Android falls back to its GitHub releases; iOS gets none until the app is on
 * the App Store (`MOBILE_IOS_STORE_URL` then holds its page).
 */
export function storeUrlFor(platform: MobilePlatform, config: Record<string, string | null | undefined>): string | null {
  if (platform === "ios") return config.MOBILE_IOS_STORE_URL?.trim() || null;
  return config.MOBILE_STORE_URL?.trim() || DEFAULT_MOBILE_STORE_URL;
}
