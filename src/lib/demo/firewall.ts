/**
 * Demo firewall: routes refused in demo mode whatever the permissions say
 * (defense in depth on top of DEMO_BLOCKED_PERMISSIONS). Pure, so the proxy
 * and the routes it does not cover (large uploads) share the same rules.
 */
import { DEMO_USER_ID } from "./index";

type Rule = { methods: "all" | "write"; path: RegExp };

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const RULES: readonly Rule[] = [
  // Administration: settings, roles, audit, backups, import, migration, cache, purges
  { methods: "write", path: /^\/api\/config$/ },
  { methods: "write", path: /^\/api\/roles(\/|$)/ },
  { methods: "all", path: /^\/api\/(audit|logs|backups|import|migration|cache|system|storage)(\/|$)/ },
  { methods: "all", path: /^\/api\/[a-z-]+\/purge$/ },
  // Outgoing services and their settings: e-mail, SMS, weekly summary, API keys, MCP, AI chat
  { methods: "all", path: /^\/api\/(email|sms|webhook-logs|webhook-status|weekly-summary|api-keys)(\/|$)/ },
  // The blocklist check stays readable: the user form calls it
  { methods: "all", path: /^\/api\/email-blocklist(\/(?!check$)[^/]+)?$/ },
  { methods: "all", path: /^\/api\/mcp(\/|$)/ },
  { methods: "all", path: /^\/(mcp-authorize|\.well-known\/oauth-[a-z-]+)(\/|$)/ },
  { methods: "all", path: /^\/api\/profile\/mcp-keys(\/|$)/ },
  { methods: "all", path: /^\/api\/ai-chat\/(admin|conversations|attachments|scope-projects)(\/|$)/ },
  { methods: "all", path: /^\/api\/auth\/send-reset$/ },
  // Uploads: branding, avatars, task attachments
  { methods: "all", path: /^\/api\/branding\/upload$/ },
  { methods: "write", path: /^\/api\/profile\/avatar$/ },
  { methods: "write", path: /^\/api\/tasks\/[^/]+\/files$/ },
  // The demo account itself
  { methods: "write", path: new RegExp(`^/api/users/${DEMO_USER_ID}(/|$)`) },
];

/** `pathname` is compared in lower case: some routes are rewritten from other casings. */
export function isDemoBlockedRoute(method: string, pathname: string): boolean {
  const path = pathname.toLowerCase();
  const write = WRITE_METHODS.has(method.toUpperCase());
  return RULES.some((rule) => (rule.methods === "all" || write) && rule.path.test(path));
}
