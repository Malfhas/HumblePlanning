import { z } from "zod";
import type { UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiChatConversations, aiChatMessages } from "@/db/schema";
import { AppError, requireAuth, assertUuid, validateBody } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { assertReplyLimits, assertScope, getUserConversation, respond } from "@/lib/ai-chat/chat-service";
import { handleChatError } from "@/lib/ai-chat/http";
import { assertQuotaNotReached } from "@/lib/ai-chat/quota-service";

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  messages: z.array(z.any()).min(1),
  model: z.string().max(200).optional(),
  reasoning: z.enum(["none", "low", "medium", "high"]).optional(),
  /** Scope of a floating orb message: the open project, otherwise the whole schedule (null). */
  projectId: z.string().uuid().nullable().optional(),
  /** The open page (floating orb): bounds the turn's tools. Absent in full-screen mode. */
  page: z.string().max(60).nullable().optional(),
});

/**
 * One conversation turn, streamed as it goes. The response follows the
 * AI SDK stream protocol, which the client reads natively.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    // Permissions re-read from the DB: a revoked right applies from the next turn
    const { perms, canWrite, config } = await assertAiChatAvailable(userId, { fresh: true });
    const { id } = await params;
    const invalid = assertUuid(id);
    if (invalid) return invalid;
    const input = await validateBody(request, sendSchema);

    /**
     * The conversation is checked BEFORE writing to it: a refusal does not erase a
     * line already written in someone else's history.
     */
    const conversation = await getUserConversation(userId, id);
    // Monthly quota reached: refused (403) before writing and before any call to the
    // provider. A response already in progress runs to completion.
    await assertQuotaNotReached(userId);
    // One response at a time per conversation, N per user: refused (409) before writing
    await assertReplyLimits(userId, id, config.maxConcurrentPerUser);

    /**
     * Message scope. The floating orb sends it with each message; it is
     * checked as at creation, then becomes the conversation's current
     * scope. A conversation from the Assistant page froze its scope at the
     * first question: it cannot be changed through this path.
     */
    let projectId = conversation.projectId;
    if (input.projectId !== undefined) {
      if (!conversation.followsNavigation) {
        throw new AppError("aiChat.errors.fixedScope");
      }
      projectId = input.projectId ?? null;
      await assertScope(perms, projectId);
      if (projectId !== conversation.projectId) {
        await db.update(aiChatConversations).set({ projectId }).where(eq(aiChatConversations.id, id));
      }
    }

    // The question is recorded before the call: if the model fails, we still know
    // what was asked. A resume after approval or a regeneration
    // re-sends the history without a new question: nothing to write.
    const last = input.messages[input.messages.length - 1] as UIMessage;
    const text =
      last?.role !== "user"
        ? ""
        : (last.parts ?? [])
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    if (text) {
      await db.insert(aiChatMessages).values({ conversationId: id, role: "USER", content: text, projectId });
    }

    /**
     * "Left before the end": the response body was not delivered in
     * full (tab closed, connection lost). The response is closed in the DB a
     * moment after the last chunk: a signal raised after a complete
     * delivery must not count. Equivalent of `writableFinished` in the original
     * project.
     */
    const clientLeft = new AbortController();
    let delivered = false;
    request.signal.addEventListener("abort", () => {
      if (!delivered) clientLeft.abort();
    });

    const result = await respond({
      userId,
      perms,
      canWrite,
      config,
      conversationId: id,
      messages: input.messages as UIMessage[],
      model: input.model,
      reasoning: input.reasoning,
      page: conversation.followsNavigation ? (input.page ?? null) : null,
      /**
       * Presence signal, not cancellation: a connection dropped before the end
       * stops nothing (the service consumes the stream itself), it only
       * says that the user will need to be notified in the app.
       */
      clientLeft: clientLeft.signal,
    });

    // `no-transform`: neither compression nor a proxy must hold back the stream
    const response = result.toUIMessageStreamResponse({
      headers: { "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
    const reader = response.body!.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          delivered = true;
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        if (!delivered) clientLeft.abort();
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (error) {
    return handleChatError(error);
  }
}
