import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getAiChatAvailability } from "@/lib/ai-chat/availability";

export const dynamic = "force-dynamic";

/**
 * Chat availability for the logged-in user: always 200, without revealing
 * anything about the configuration (the cause is only shown to the admin).
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const a = await getAiChatAvailability(session.user.id);
    return apiSuccess({ available: a.available, canWrite: a.canWrite, widget: a.widget });
  } catch (error) {
    return handleApiError(error);
  }
}
