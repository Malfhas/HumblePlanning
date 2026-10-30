import { apiError } from "@/lib/utils/api";
import { isDemoMode } from "./index";
import { isDemoBlockedRoute } from "./firewall";

/**
 * Demo firewall for the routes outside the proxy matcher (large uploads:
 * import, backups, branding, AI chat attachments; and /api/auth). Returns the
 * 403 to send, or null when the request may go on.
 */
export async function refuseInDemo(request: Request): Promise<Response | null> {
  if (!isDemoMode() || !isDemoBlockedRoute(request.method, new URL(request.url).pathname)) return null;
  return apiError("errors.demoRestricted", 403);
}
