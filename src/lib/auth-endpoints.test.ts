import { describe, expect, it } from "bun:test";
import { isHttpAuthEndpoint } from "./auth-endpoints";

describe("Better Auth HTTP endpoints", () => {
  it("serves the session and sign-out endpoints used by the client", () => {
    expect(isHttpAuthEndpoint("GET", "/api/auth/get-session")).toBe(true);
    expect(isHttpAuthEndpoint("POST", "/api/auth/sign-out")).toBe(true);
  });

  it("closes the native endpoints that bypass /api/auth/login or the app validation", () => {
    for (const path of [
      "/api/auth/sign-in/username", "/api/auth/sign-in/email", "/api/auth/sign-up/email",
      "/api/auth/update-user", "/api/auth/revoke-sessions", "/api/auth/revoke-other-sessions",
      "/api/auth/is-username-available", "/api/auth/verify-password", "/api/auth/delete-user",
    ]) {
      expect(isHttpAuthEndpoint("POST", path)).toBe(false);
    }
    expect(isHttpAuthEndpoint("GET", "/api/auth/sign-out")).toBe(false);
  });

  it("matches the exact path only", () => {
    expect(isHttpAuthEndpoint("GET", "/api/auth/get-session/")).toBe(false);
    expect(isHttpAuthEndpoint("GET", "/api/auth/Get-Session")).toBe(false);
    expect(isHttpAuthEndpoint("POST", "/api/auth/sign-in%2Fusername")).toBe(false);
    expect(isHttpAuthEndpoint("GET", "constructor")).toBe(false);
  });
});
