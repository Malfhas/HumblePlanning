import { requireAuth, requirePermission, apiSuccess, handleApiError, assertUuid } from "@/lib/utils/api";
import { logAudit } from "@/lib/services/audit-service";
import { getQuotaAccount, upsertQuotaOverride } from "@/lib/ai-chat/quota-admin";

export const dynamic = "force-dynamic";

/** Reset of a single account. */
export async function POST(_: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const { userId } = await params;
    const invalid = assertUuid(userId);
    if (invalid) return invalid;
    const account = await getQuotaAccount(userId);
    const resetAt = new Date();
    await upsertQuotaOverride(userId, { resetAt });
    logAudit({
      userId: session.user.id,
      action: "config_change",
      entityType: "user",
      entityId: userId,
      // Audit log keys: stored data, kept under their original names
      newValues: { compte: account.email ?? account.name, reinitialiseLe: resetAt.toISOString() },
      metadata: { scope: "ai_chat_quota", operation: "reset_user" },
    }).catch(() => {});
    return apiSuccess({ ok: true, resetAt: resetAt.toISOString() });
  } catch (error) {
    return handleApiError(error);
  }
}
