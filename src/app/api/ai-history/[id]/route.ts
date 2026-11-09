import { requireAuth, requirePermission, apiSuccess, handleApiError, assertUuid, AppError } from "@/lib/utils/api";
import { getAiConversationDetail } from "@/lib/services/ai-history-service";

/** AI history: one conversation, its messages and tool calls (deleted ones included). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:ai_history");
    const { id } = await params;
    assertUuid(id);
    const detail = await getAiConversationDetail(id);
    if (!detail) throw new AppError("admin.aiHistory.errors.notFound", { status: 404 });
    return apiSuccess(detail);
  } catch (error) {
    return handleApiError(error);
  }
}
