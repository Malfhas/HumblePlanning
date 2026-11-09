import { describe, expect, it } from "bun:test";
import { DEFAULT_MOBILE_STORE_URL } from "./app-version";
import { hasPush, mobilePlatformOf, storeUrlFor } from "./mobile-platform";

const headers = (platform?: string) => new Headers(platform === undefined ? {} : { "X-App-Platform": platform });

describe("mobilePlatformOf", () => {
  it("treats an app that sends no platform as the Android app (1.0.x)", () => {
    expect(mobilePlatformOf(headers())).toBe("android");
    expect(mobilePlatformOf(headers("android"))).toBe("android");
  });

  it("recognizes the iOS app, and nothing else as iOS", () => {
    expect(mobilePlatformOf(headers("ios"))).toBe("ios");
    expect(mobilePlatformOf(headers(" iOS "))).toBe("ios");
    expect(mobilePlatformOf(headers("ipados"))).toBe("android");
  });
});

describe("storeUrlFor", () => {
  it("sends each app to the download page of its platform", () => {
    const config = { MOBILE_STORE_URL: "https://example.com/android", MOBILE_IOS_STORE_URL: "https://apps.apple.com/app/id1" };
    expect(storeUrlFor("android", config)).toBe("https://example.com/android");
    expect(storeUrlFor("ios", config)).toBe("https://apps.apple.com/app/id1");
  });

  it("falls back to the GitHub releases on Android, and to no page on iOS", () => {
    expect(storeUrlFor("android", { MOBILE_STORE_URL: "  " })).toBe(DEFAULT_MOBILE_STORE_URL);
    expect(storeUrlFor("ios", { MOBILE_STORE_URL: "https://example.com/android" })).toBeNull();
    expect(storeUrlFor("ios", { MOBILE_IOS_STORE_URL: " " })).toBeNull();
  });
});

describe("hasPush", () => {
  it("is for Android devices only until push through APNs exists", () => {
    expect(hasPush("android")).toBe(true);
    expect(hasPush("ios")).toBe(false);
  });
});
