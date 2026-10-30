import { describe, expect, it } from "bun:test";
import { computeAvailability, serviceReasonsOf } from "./availability";
import type { UserPermissions } from "@/lib/services/permission-service";

const perms = (permissions: string[], isAdmin = false): UserPermissions => ({
  userId: "u",
  roleId: "r",
  teamId: null,
  businessUnitId: null,
  permissions,
  isAdmin,
});
const enabledConfig = { enabled: true, apiKey: "sk-or-x", models: ["m/a"], widgetEnabled: true, widgetClosable: true };

describe("AI chat availability (matrix)", () => {
  it("disabled: unavailable, reason disabled", () => {
    const a = computeAvailability({ ...enabledConfig, enabled: false }, perms(["ai_chat:use"]));
    expect(a).toMatchObject({ available: false, canWrite: false, reason: "disabled" });
    expect(a.widget.visible).toBe(false);
  });

  it("no key: unavailable, reason missing_api_key", () => {
    expect(computeAvailability({ ...enabledConfig, apiKey: null }, perms(["ai_chat:use"])).reason).toBe("missing_api_key");
  });

  it("key provided by .env: available (the key source does not matter)", () => {
    // getConfigValue reads `.env` first: the key arrives here already resolved
    expect(computeAvailability({ ...enabledConfig, apiKey: "env-key" }, perms(["ai_chat:use"])).available).toBe(true);
  });

  it("no model: unavailable, reason no_model", () => {
    expect(computeAvailability({ ...enabledConfig, models: [] }, perms(["ai_chat:use"])).reason).toBe("no_model");
  });

  it("every reason is returned to the admin, in order", () => {
    expect(serviceReasonsOf({ enabled: false, apiKey: null, models: [] })).toEqual(["disabled", "missing_api_key", "no_model"]);
  });

  it("without ai_chat:use: forbidden, before any service reason", () => {
    const a = computeAvailability({ ...enabledConfig, enabled: false }, perms(["pages:planning"]));
    expect(a.reason).toBe("forbidden");
    expect(a.serviceReasons).toEqual(["disabled"]);
  });

  it("use without write: available read-only", () => {
    expect(computeAvailability(enabledConfig, perms(["ai_chat:use"]))).toMatchObject({ available: true, canWrite: false });
  });

  it("write without use: forbidden (write alone opens nothing)", () => {
    expect(computeAvailability(enabledConfig, perms(["ai_chat:write"])).reason).toBe("forbidden");
  });

  it("use and write: read and write", () => {
    expect(computeAvailability(enabledConfig, perms(["ai_chat:use", "ai_chat:write"]))).toMatchObject({ available: true, canWrite: true });
  });

  it("isAdmin (Super Administrator): bypass, read and write", () => {
    expect(computeAvailability(enabledConfig, perms([], true))).toMatchObject({ available: true, canWrite: true, reason: null });
  });

  it("sphere: visible only when the chat is available and the widget enabled", () => {
    expect(computeAvailability({ ...enabledConfig, widgetEnabled: false }, perms(["ai_chat:use"])).widget.visible).toBe(false);
    expect(computeAvailability(enabledConfig, perms(["ai_chat:use"])).widget).toEqual({ visible: true, closable: true });
  });
});
