import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { logAudit } from "@/lib/services/audit-service";
import { getAiChatConfig, resetAiChatQuotaForEveryone } from "@/lib/ai-chat/config";
import { quotaSettingsView } from "@/lib/ai-chat/quota-admin";

export const dynamic = "force-dynamic";

/** Reset for everyone: the current period restarts from now. */
export async function POST() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const now = new Date();
    await resetAiChatQuotaForEveryone(now);
    logAudit({
      userId: session.user.id,
      action: "config_change",
      entityType: "config",
      // Audit log key: stored data, kept under its original name
      newValues: { reinitialiseLe: now.toISOString() },
      metadata: { scope: "ai_chat_quota", operation: "reset_all" },
    }).catch(() => {});
    return apiSuccess({ settings: quotaSettingsView((await getAiChatConfig()).quota) });
  } catch (error) {
    return handleApiError(error);
  }
}
