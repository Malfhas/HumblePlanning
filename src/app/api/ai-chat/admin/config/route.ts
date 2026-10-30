import { z } from "zod";
import { requireAuth, requirePermission, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { logAudit } from "@/lib/services/audit-service";
import { serviceReasonsOf } from "@/lib/ai-chat/availability";
import {
  aiChatSettingsSchema,
  getAiChatConfig,
  isApiKeyEnvManaged,
  saveAiChatSettings,
  type AiChatConfig,
} from "@/lib/ai-chat/config";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai-chat/prompts";
import { emitAiChatAvailabilityChanged } from "@/lib/ai-chat/realtime";

export const dynamic = "force-dynamic";

/** What the admin sees: never the key, only whether it exists and where it comes from. */
function adminView(config: AiChatConfig) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey, quota, ...settings } = config;
  const reasons = serviceReasonsOf(config);
  return {
    config: settings,
    apiKey: { configured: Boolean(apiKey), envManaged: isApiKeyEnvManaged() },
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    status: { active: reasons.length === 0, reasons },
  };
}

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    return apiSuccess(adminView(await getAiChatConfig()));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = aiChatSettingsSchema.extend({
  /** New key; empty or absent: the saved key is kept. */
  apiKey: z.string().max(500).optional(),
  /** Removes the key saved in the DB (no effect if it comes from `.env`). */
  clearApiKey: z.boolean().optional(),
});

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const { apiKey, clearApiKey, ...settings } = await validateBody(request, updateSchema);
    const before = await getAiChatConfig();
    const newKey = clearApiKey ? "" : apiKey?.trim() ? apiKey.trim() : undefined;
    /**
     * The chat turns itself on when its configuration becomes complete (a key
     * and at least one model): the admin does not have to come back to enable it.
     * A chat already configured then manually turned off stays off.
     */
    const keyAfter = newKey === undefined || isApiKeyEnvManaged() ? before.apiKey : newKey || null;
    const isConfigured = (key: string | null, models: string[]) => Boolean(key) && models.length > 0;
    if (!settings.enabled && !before.enabled && !isConfigured(before.apiKey, before.models) && isConfigured(keyAfter, settings.models)) {
      settings.enabled = true;
    }
    await saveAiChatSettings(settings, newKey);
    const after = await getAiChatConfig();

    // Audit: the changed settings, the key only as "modified", never in clear text
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const key of Object.keys(settings) as (keyof typeof settings)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        oldValues[key] = before[key];
        newValues[key] = after[key];
      }
    }
    if (newKey !== undefined && !isApiKeyEnvManaged()) {
      oldValues.openrouterApiKey = before.apiKey ? "••••••••" : null;
      newValues.openrouterApiKey = newKey ? "••••••••" : null;
    }
    if (Object.keys(newValues).length > 0) {
      logAudit({
        userId: session.user.id,
        action: "config_change",
        entityType: "config",
        oldValues,
        newValues,
        metadata: { scope: "ai_chat", changedKeys: Object.keys(newValues) },
        changeCount: Object.keys(newValues).length,
      }).catch(() => {});
    }
    // Each client re-reads its availability: orb and menu appear or disappear without F5
    void emitAiChatAvailabilityChanged();
    return apiSuccess(adminView(after));
  } catch (error) {
    return handleApiError(error);
  }
}
