import { NextRequest } from "next/server";
import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { previewAiHistoryPurge, purgeAiHistory } from "@/lib/services/ai-history-service";
import { getInstanceTimezone } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { purgeBeforeSchema, parseQuery } from "@/lib/validators/system-health";
import { purgeBeforeInstant } from "@/lib/system-health/retention";

async function cutoffOf(before: string): Promise<Date> {
  const cutoff = purgeBeforeInstant(before, await getInstanceTimezone());
  if (!cutoff) throw new AppError("errors.invalidData", { status: 422 });
  return cutoff;
}

/** What a purge « before the » date would erase (last activity before that day). */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "ai_history:purge");
    const { before } = parseQuery(purgeBeforeSchema, request.nextUrl.searchParams);
    return apiSuccess(await previewAiHistoryPurge(await cutoffOf(before)));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Erases the conversations idle since before that day; recorded in the audit log. */
export async function DELETE(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "ai_history:purge");
    const { before } = await validateBody(request, purgeBeforeSchema);
    const result = await purgeAiHistory(await cutoffOf(before));
    await logAudit({
      userId: session.user.id,
      action: "purge",
      entityType: "ai_history",
      metadata: { count: result.conversations, before, messages: result.messages, ledgerEntries: result.ledgerEntries },
    });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
