import { z } from "zod";
import { requireAuth, requirePermission, apiSuccess, handleApiError, validateBody } from "@/lib/utils/api";
import { logAudit } from "@/lib/services/audit-service";
import { getAiChatConfig, saveAiChatQuotaSettings } from "@/lib/ai-chat/config";
import { quotaSettingsAuditValues, quotaSettingsView } from "@/lib/ai-chat/quota-admin";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  enabled: z.boolean(),
  /** Per person and per month, in dollars; 0 = unlimited for everyone. */
  amountUsd: z.number().min(0).max(100_000),
  resetDay: z.number().int().min(1).max(28),
});

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const input = await validateBody(request, settingsSchema);
    const before = (await getAiChatConfig()).quota;
    // The global reset is not a setting: it is kept as is
    await saveAiChatQuotaSettings({ enabled: input.enabled, monthlyUsd: input.amountUsd, resetDay: input.resetDay });
    const after = (await getAiChatConfig()).quota;
    logAudit({
      userId: session.user.id,
      action: "config_change",
      entityType: "config",
      oldValues: quotaSettingsAuditValues(before),
      newValues: quotaSettingsAuditValues(after),
      metadata: { scope: "ai_chat_quota" },
    }).catch(() => {});
    return apiSuccess({ settings: quotaSettingsView(after) });
  } catch (error) {
    return handleApiError(error);
  }
}
