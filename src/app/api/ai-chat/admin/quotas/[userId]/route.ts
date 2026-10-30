import { z } from "zod";
import { requireAuth, requirePermission, apiSuccess, handleApiError, assertUuid, validateBody } from "@/lib/utils/api";
import { logAudit } from "@/lib/services/audit-service";
import { getQuotaAccount, upsertQuotaOverride } from "@/lib/ai-chat/quota-admin";

export const dynamic = "force-dynamic";

/** Exempts an account from the quota, or subjects it to it again. */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const { userId } = await params;
    const invalid = assertUuid(userId);
    if (invalid) return invalid;
    const { unlimited } = await validateBody(request, z.object({ unlimited: z.boolean() }));
    const account = await getQuotaAccount(userId);
    await upsertQuotaOverride(userId, { unlimited });
    logAudit({
      userId: session.user.id,
      action: "config_change",
      entityType: "user",
      entityId: userId,
      // Audit log keys: stored data, kept under their original names
      oldValues: { illimite: Boolean(account.unlimited) },
      newValues: { illimite: unlimited, compte: account.email ?? account.name },
      metadata: { scope: "ai_chat_quota", operation: "unlimited_updated" },
    }).catch(() => {});
    return apiSuccess({ ok: true, unlimited });
  } catch (error) {
    return handleApiError(error);
  }
}
