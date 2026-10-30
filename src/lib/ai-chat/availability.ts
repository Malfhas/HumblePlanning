import {
  fetchUserPermissions,
  hasPermission,
  loadUserPermissions,
  type UserPermissions,
} from "@/lib/services/permission-service";
import { AppError } from "@/lib/errors";
import { getAiChatConfig, type AiChatConfig } from "./config";

/**
 * AI chat availability, in a single place: the /assistant page (server-side
 * redirect), the sphere, the sidebar entry and all API routes check it. When
 * unavailable, the chat does not exist for the user: no sphere, no menu, no
 * page, and the API responds with a generic message that reveals nothing
 * about the configuration.
 */

export type AiChatServiceReason = "disabled" | "missing_api_key" | "no_model";

export interface AiChatAvailability {
  available: boolean;
  /** `ai_chat:use` and `ai_chat:write` (isAdmin bypass included). */
  canWrite: boolean;
  /** First cause, in route order: the permission, then the service. */
  reason: AiChatServiceReason | "forbidden" | null;
  /** All service-side causes, for the admin. */
  serviceReasons: AiChatServiceReason[];
  widget: { visible: boolean; closable: boolean };
}

/** The reasons the service is unavailable, regardless of the user. */
export function serviceReasonsOf(config: Pick<AiChatConfig, "enabled" | "apiKey" | "models">): AiChatServiceReason[] {
  const reasons: AiChatServiceReason[] = [];
  if (!config.enabled) reasons.push("disabled");
  if (!config.apiKey) reasons.push("missing_api_key");
  if (config.models.length === 0) reasons.push("no_model");
  return reasons;
}

/** Pure computation, covered by unit tests (availability matrix). */
export function computeAvailability(
  config: Pick<AiChatConfig, "enabled" | "apiKey" | "models" | "widgetEnabled" | "widgetClosable">,
  perms: UserPermissions,
): AiChatAvailability {
  const serviceReasons = serviceReasonsOf(config);
  const canUse = hasPermission(perms, "ai_chat:use");
  const reason = !canUse ? "forbidden" : (serviceReasons[0] ?? null);
  const available = reason === null;
  return {
    available,
    canWrite: available && hasPermission(perms, "ai_chat:write"),
    reason,
    serviceReasons,
    widget: { visible: available && config.widgetEnabled, closable: config.widgetClosable },
  };
}

/**
 * `fresh`: permissions re-read from the database (like the MCP server) for
 * actions that commit to something (send a message, stop, run a tool).
 * Otherwise the 2-minute cache is enough (page, sidebar, sphere).
 */
export async function getAiChatAvailability(
  userId: string,
  opts?: { fresh?: boolean },
): Promise<AiChatAvailability> {
  const [config, perms] = await Promise.all([
    getAiChatConfig(),
    opts?.fresh ? fetchUserPermissions(userId) : loadUserPermissions(userId),
  ]);
  return computeAvailability(config, perms);
}

/**
 * API route guard: 403 without the permission, 503 if the service is
 * turned off or incomplete. The message stays generic.
 */
export async function assertAiChatAvailable(
  userId: string,
  opts?: { fresh?: boolean },
): Promise<{ perms: UserPermissions; canWrite: boolean; config: AiChatConfig }> {
  const [config, perms] = await Promise.all([
    getAiChatConfig(),
    opts?.fresh ? fetchUserPermissions(userId) : loadUserPermissions(userId),
  ]);
  const availability = computeAvailability(config, perms);
  if (availability.reason === "forbidden") throw new AppError("errors.forbidden");
  if (!availability.available) throw new AppError("aiChat.errors.unavailable");
  return { perms, canWrite: availability.canWrite, config };
}
