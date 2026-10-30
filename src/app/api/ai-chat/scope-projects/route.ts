import { requireAuth, apiSuccess } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { scopeProjects } from "@/lib/ai-chat/chat-service";
import { handleChatError } from "@/lib/ai-chat/http";

export const dynamic = "force-dynamic";

/** Projects offered by the scope picker: those the user can see, not archived. */
export async function GET() {
  try {
    const session = await requireAuth();
    const { perms } = await assertAiChatAvailable(session.user.id);
    const projectList = await scopeProjects(perms);
    return apiSuccess(projectList.map((p) => ({ id: p.id, number: p.businessNumber || p.name, name: p.name })));
  } catch (error) {
    return handleChatError(error);
  }
}
