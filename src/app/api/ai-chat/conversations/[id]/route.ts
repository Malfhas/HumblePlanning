import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiChatConversations, aiChatMessages } from "@/db/schema";
import { requireAuth, apiSuccess, assertUuid, validateBody } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { assertScope, getUserConversation } from "@/lib/ai-chat/chat-service";
import { getListedConversation } from "@/lib/ai-chat/conversations";
import { handleChatError } from "@/lib/ai-chat/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Detail: the 200 most recent messages, put back in chronological order. */
export async function GET(_: Request, { params }: Params) {
  try {
    const session = await requireAuth();
    await assertAiChatAvailable(session.user.id);
    const { id } = await params;
    const invalid = assertUuid(id);
    if (invalid) return invalid;
    await getUserConversation(session.user.id, id);
    const messages = await db
      .select({
        id: aiChatMessages.id,
        role: aiChatMessages.role,
        content: aiChatMessages.content,
        createdAt: aiChatMessages.createdAt,
        model: aiChatMessages.model,
        status: aiChatMessages.status,
        error: aiChatMessages.error,
      })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.conversationId, id))
      // Stable tie-break by id: even with equal timestamps, the order is deterministic
      .orderBy(desc(aiChatMessages.createdAt), desc(aiChatMessages.id))
      .limit(200);
    messages.reverse();
    return apiSuccess({
      ...(await getListedConversation(session.user.id, id)),
      messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    });
  } catch (error) {
    return handleChatError(error);
  }
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** Pinned at the top of the list (true) or put back among the recent ones (false). */
  pinned: z.boolean().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireAuth();
    const { perms } = await assertAiChatAvailable(session.user.id);
    const { id } = await params;
    const invalid = assertUuid(id);
    if (invalid) return invalid;
    const input = await validateBody(request, updateSchema);
    await getUserConversation(session.user.id, id);
    // Changing scope mid-conversation is still subject to the same rights
    if (input.projectId !== undefined) await assertScope(perms, input.projectId);
    await db
      .update(aiChatConversations)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date() : null } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      })
      .where(and(eq(aiChatConversations.id, id), eq(aiChatConversations.userId, session.user.id)));
    return apiSuccess(await getListedConversation(session.user.id, id));
  } catch (error) {
    return handleChatError(error);
  }
}

/** Soft delete: the conversation stays in the DB, its cost remains due. */
export async function DELETE(_: Request, { params }: Params) {
  try {
    const session = await requireAuth();
    await assertAiChatAvailable(session.user.id);
    const { id } = await params;
    const invalid = assertUuid(id);
    if (invalid) return invalid;
    await db
      .update(aiChatConversations)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(aiChatConversations.id, id),
          eq(aiChatConversations.userId, session.user.id),
          isNull(aiChatConversations.deletedAt),
        ),
      );
    return apiSuccess({ ok: true });
  } catch (error) {
    return handleChatError(error);
  }
}
