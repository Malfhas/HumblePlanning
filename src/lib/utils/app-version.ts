/**
 * Oldest version of the mobile app this server release works with. Raised in a
 * release when the API changes in a way older apps cannot handle: servers apply
 * it as soon as they are updated, without any setting. The MOBILE_MIN_APP_VERSION
 * setting can only raise it (`effectiveMinimumVersion`).
 */
export const RELEASE_MIN_APP_VERSION = "1.0.2";

/** Download page opened by an outdated app when MOBILE_STORE_URL is empty: the app's GitHub releases. */
export const DEFAULT_MOBILE_STORE_URL = "https://github.com/Malfhas/HumblePlanning-Android/releases/latest";

/**
 * Numeric comparison of dotted versions (`1.10.0` > `1.9.3`). A suffix
 * (`1.2.0-debug`) and missing segments are ignored; a non-numeric segment
 * counts as 0. Negative when `a` is older than `b`.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().split("-")[0].split(".").map((s) => parseInt(s, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Minimum app version enforced: the one of this server release, or the
 * administrator's setting when it is newer. A setting that is not a version
 * (no digit) is ignored.
 */
export function effectiveMinimumVersion(setting: string | null | undefined, release: string = RELEASE_MIN_APP_VERSION): string {
  const value = setting?.trim();
  if (!value || !/^\d/.test(value)) return release;
  return compareVersions(value, release) > 0 ? value : release;
}
