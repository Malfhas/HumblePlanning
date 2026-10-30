import { requireAuth, assertUuid } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { stopReply } from "@/lib/ai-chat/chat-service";
import { handleChatError } from "@/lib/ai-chat/http";

export const dynamic = "force-dynamic";

/**
 * Stops the ongoing response, server-side: since the response now completes in
 * the background, closing the HTTP stream would no longer be enough. With no ongoing
 * response, 204 anyway: there is nothing to blame on someone arriving too late.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await assertAiChatAvailable(session.user.id, { fresh: true });
    const { id } = await params;
    const invalid = assertUuid(id);
    if (invalid) return invalid;
    await stopReply(session.user.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleChatError(error);
  }
}
