import { afterEach, describe, expect, it } from "bun:test";
import { isDemoBlockedRoute } from "./firewall";
import {
  DEMO_BLOCKED_PERMISSIONS, DEMO_ROLE_PERMISSIONS, DEMO_USER_ID, assertNotDemoAccount, demoConfigOverride,
  getDemoResetTime, withoutDemoBlockedPermissions,
} from "./index";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("demo firewall", () => {
  it("closes administration, outgoing services and uploads", () => {
    for (const [method, path] of [
      ["PUT", "/api/config"], ["POST", "/api/roles"], ["DELETE", "/api/roles/abc"], ["GET", "/api/audit"],
      ["POST", "/api/audit/abc/restore"], ["GET", "/api/logs"], ["GET", "/api/backups"], ["POST", "/api/import/analyze"],
      ["POST", "/api/migration/execute"], ["DELETE", "/api/cache"], ["POST", "/api/system/version/check"], ["GET", "/api/storage"],
      ["DELETE", "/api/tasks/purge"], ["DELETE", "/api/files/purge"], ["POST", "/api/email/test"], ["GET", "/api/email-blocklist"],
      ["DELETE", "/api/email-blocklist/abc"], ["POST", "/api/sms/test"], ["POST", "/api/weekly-summary/test"], ["GET", "/api/api-keys"],
      ["POST", "/api/mcp"], ["POST", "/API/MCP"], ["GET", "/.well-known/oauth-authorization-server"], ["GET", "/mcp-authorize"],
      ["POST", "/api/ai-chat/conversations"], ["GET", "/api/ai-chat/admin/config"], ["POST", "/api/ai-chat/attachments"],
      ["POST", "/api/auth/send-reset"], ["POST", "/api/branding/upload"], ["POST", "/api/profile/avatar"],
      ["POST", "/api/tasks/abc/files"], ["PUT", `/api/users/${DEMO_USER_ID}`], ["DELETE", `/api/users/${DEMO_USER_ID}/2fa`],
    ]) {
      expect(`${method} ${path} ${isDemoBlockedRoute(method, path)}`).toBe(`${method} ${path} true`);
    }
  });

  it("leaves the business routes and the reads the interface needs", () => {
    for (const [method, path] of [
      ["GET", "/api/config"], ["GET", "/api/config/public"], ["GET", "/api/roles"], ["GET", "/api/email-blocklist/check"],
      ["GET", "/api/ai-chat/access"], ["GET", "/api/ai-chat/availability"], ["POST", "/api/tasks"], ["PUT", "/api/tasks/abc"],
      ["GET", "/api/tasks/abc/files"], ["POST", "/api/users"], ["PUT", "/api/users/11111111-2222-4333-8444-555555555555"],
      ["GET", `/api/users/${DEMO_USER_ID}`], ["GET", "/api/profile/avatar"], ["PUT", "/api/profile/preferences"],
      ["POST", "/api/projects"], ["GET", "/planning"], ["POST", "/api/auth/login"],
    ]) {
      expect(`${method} ${path} ${isDemoBlockedRoute(method, path)}`).toBe(`${method} ${path} false`);
    }
  });
});

describe("demo permissions and settings", () => {
  it("the Démo role has no blocked permission", () => {
    expect(DEMO_ROLE_PERMISSIONS.filter((p) => DEMO_BLOCKED_PERMISSIONS.has(p))).toEqual([]);
    expect(DEMO_ROLE_PERMISSIONS).toContain("users:create");
  });

  it("removes administration from every role, Super Admin included, only in demo mode", () => {
    const superAdmin = { userId: "u", roleId: "r", teamId: null, businessUnitId: null, permissions: ["settings:edit", "tasks:create"], isAdmin: true };
    process.env.DEMO_MODE = "false";
    expect(withoutDemoBlockedPermissions(superAdmin)).toBe(superAdmin);
    process.env.DEMO_MODE = "true";
    expect(withoutDemoBlockedPermissions(superAdmin)).toMatchObject({ isAdmin: false, permissions: ["tasks:create"] });
  });

  it("forces the outgoing services off, only in demo mode", () => {
    process.env.DEMO_MODE = "true";
    expect(demoConfigOverride("MCP_ENABLED")).toBe("false");
    expect(demoConfigOverride("AI_CHAT_ENABLED")).toBe("false");
    expect(demoConfigOverride("APP_TITLE")).toBeUndefined();
    expect(demoConfigOverride("constructor")).toBeUndefined();
    process.env.DEMO_MODE = "false";
    expect(demoConfigOverride("MCP_ENABLED")).toBeUndefined();
  });

  it("locks the demo account in demo mode only", () => {
    process.env.DEMO_MODE = "true";
    expect(() => assertNotDemoAccount(DEMO_USER_ID)).toThrow();
    expect(() => assertNotDemoAccount("11111111-2222-4333-8444-555555555555")).not.toThrow();
    process.env.DEMO_MODE = "false";
    expect(() => assertNotDemoAccount(DEMO_USER_ID)).not.toThrow();
  });

  it("validates the reset time", () => {
    process.env.DEMO_RESET_TIME = "04:30";
    expect(getDemoResetTime()).toBe("04:30");
    for (const bad of ["24:00", "4h", "", "03:60"]) {
      process.env.DEMO_RESET_TIME = bad;
      expect(getDemoResetTime()).toBe("03:00");
    }
  });
});
