/**
 * Demo mode (`DEMO_MODE=true` in .env, never from the interface): a public
 * demonstration instance.
 *
 * - At each start and every night at `DEMO_RESET_TIME`, every piece of data is
 *   erased and a demo dataset is generated (./reset.ts), with a fixed demo
 *   account whose credentials come from `DEMO_LOGIN` / `DEMO_PASSWORD`.
 * - Administration is unavailable to everyone: the permissions below are
 *   removed when permissions are loaded, and ./firewall.ts refuses the
 *   matching routes whatever the permissions say.
 * - Outgoing traffic is off (e-mails, SMS, update checks, AI chat, MCP, API keys)
 *   and so are uploads.
 */
import { AppError } from "@/lib/errors";

export const DEMO_ROLE_ID = "00000000-0000-0000-0000-000000000006";
export const DEMO_USER_ID = "00000000-0000-0000-0000-00000000de30";

const RESET_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function getDemoCredentials(): { login: string; password: string } | null {
  if (!isDemoMode()) return null;
  return {
    login: process.env.DEMO_LOGIN || "demo",
    password: process.env.DEMO_PASSWORD || "demo",
  };
}

/** Daily reset time (HH:MM, instance time zone); 03:00 when missing or invalid. */
export function getDemoResetTime(): string {
  const value = process.env.DEMO_RESET_TIME ?? "";
  return RESET_TIME_RE.test(value) ? value : "03:00";
}

export function isDemoAccount(userId: string | null | undefined): boolean {
  return isDemoMode() && userId === DEMO_USER_ID;
}

/** Refuses any change to the demo account: profile, credentials, 2FA, sessions, role, deletion. */
export function assertNotDemoAccount(userId: string | null | undefined): void {
  if (isDemoAccount(userId)) {
    throw new AppError("errors.demoAccountLocked", { status: 403 });
  }
}

/** Permissions removed from every role in demo mode. */
export const DEMO_BLOCKED_PERMISSIONS: ReadonlySet<string> = new Set([
  // Administration
  "pages:settings", "settings:edit",
  "pages:roles", "roles:create", "roles:edit", "roles:delete",
  "pages:audit", "audit:purge", "audit:restore",
  "pages:backups", "backups:create", "backups:delete", "backups:download",
  // Uploads (the demo must not host files)
  "pages:files", "files:upload", "files:delete", "files:purge",
  // Outgoing services
  "mcp:use", "mcp:write",
  "ai_chat:use", "ai_chat:write",
]);

/** Business permissions of the "Démo" role: everything outside the Administration menu. */
export const DEMO_ROLE_PERMISSIONS: readonly string[] = [
  "business_units:create", "business_units:delete", "business_units:edit",
  "export:use",
  "files:view",
  "groups:edit",
  "labor_types:edit",
  "notifications:view",
  "pages:business_units", "pages:home",
  "pages:labor_types", "pages:places", "pages:planning", "pages:projects",
  "pages:qualifications", "pages:resource_types", "pages:resources",
  "pages:stats_projects", "pages:stats_roi", "pages:stats_users",
  "pages:tasks", "pages:teams", "pages:users",
  "pages:vehicle_types", "pages:vehicles",
  "places:edit",
  "planning:view_calendar", "planning:view_resources", "planning:view_team_day",
  "planning:view_vehicles",
  "projects:archive", "projects:create", "projects:delete", "projects:edit",
  "qualifications:edit",
  "resource_types:edit",
  "resources:create", "resources:delete", "resources:edit",
  "scope:bu_all", "scope:modify_all", "scope:projects_all", "scope:users_all",
  "statuses:edit",
  "tasks:assign", "tasks:create", "tasks:delete", "tasks:lock", "tasks:move", "tasks:resize",
  "teams:edit",
  "users:create", "users:delete", "users:edit",
  "vehicle_types:create", "vehicle_types:delete", "vehicle_types:edit",
  "vehicles:create", "vehicles:delete", "vehicles:edit",
];

/** In demo mode: no administrator bypass and no blocked permission, whatever the role. */
export function withoutDemoBlockedPermissions<T extends { permissions: string[]; isAdmin: boolean }>(perms: T): T {
  if (!isDemoMode()) return perms;
  return {
    ...perms,
    isAdmin: false,
    permissions: perms.permissions.filter((p) => !DEMO_BLOCKED_PERMISSIONS.has(p)),
  };
}

/** Settings forced in demo mode, whatever the database says. */
const DEMO_CONFIG_OVERRIDES = new Map<string, string>([
  ["API_ENABLED", "false"],
  ["MCP_ENABLED", "false"],
  ["AI_CHAT_ENABLED", "false"],
  ["NOTIFICATION_EMAIL_COCHE", "false"],
  ["WEEKLY_SUMMARY_ENABLED", "false"],
  ["FORGOT_PASSWORD_ENABLED", "false"],
  ["TWOFACTOR_REQUIRED", "false"],
  ["BACKUP_ENABLED", "false"],
  ["UPDATE_CHECK_ENABLED", "false"],
]);

export function demoConfigOverride(key: string): string | undefined {
  return isDemoMode() ? DEMO_CONFIG_OVERRIDES.get(key) : undefined;
}
