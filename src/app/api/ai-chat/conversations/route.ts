import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiChatConversations } from "@/db/schema";
import { requireAuth, apiSuccess, validateBody } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { assertScope } from "@/lib/ai-chat/chat-service";
import { effectiveDefaultModel } from "@/lib/ai-chat/config";
import { getListedConversation, listConversations } from "@/lib/ai-chat/conversations";
import { handleChatError } from "@/lib/ai-chat/http";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  /** Null: "Whole schedule" scope. */
  projectId: z.string().uuid().nullable().default(null),
  title: z.string().max(200).optional(),
  /**
   * Floating orb conversation: the scope follows navigation and is
   * sent with each message, instead of being frozen at the first question.
   */
  followsNavigation: z.boolean().default(false),
});

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    await assertAiChatAvailable(session.user.id);
    const followsNavigation = new URL(request.url).searchParams.get("followsNavigation") === "true";
    return apiSuccess(await listConversations(session.user.id, { followsNavigation }));
  } catch (error) {
    return handleChatError(error);
  }
}

/** The conversation is born from the first question (lazy creation on the client side). */
export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const { perms, config } = await assertAiChatAvailable(session.user.id);
    const input = await validateBody(request, createSchema);
    await assertScope(perms, input.projectId);
    // Fallback title (no question): written in the author's language, like a typed title
    const t = await getServerTranslator(await resolveRequestLocale());
    const [created] = await db
      .insert(aiChatConversations)
      .values({
        userId: session.user.id,
        projectId: input.projectId,
        followsNavigation: input.followsNavigation,
        title: input.title?.trim() || t("aiChat.conversations.defaultTitle"),
        model: effectiveDefaultModel(config),
      })
      .returning({ id: aiChatConversations.id });
    return apiSuccess(await getListedConversation(session.user.id, created.id), 201);
  } catch (error) {
    return handleChatError(error);
  }
}

/**
 * Delete everything. For the user, deleting means no longer seeing: the
 * conversations stay in the DB (soft delete), and what their messages
 * cost remains due.
 */
export async function DELETE() {
  try {
    const session = await requireAuth();
    await assertAiChatAvailable(session.user.id);
    const hidden = await db
      .update(aiChatConversations)
      .set({ deletedAt: new Date() })
      .where(and(eq(aiChatConversations.userId, session.user.id), isNull(aiChatConversations.deletedAt)))
      .returning({ id: aiChatConversations.id });
    return apiSuccess({ ok: true, count: hidden.length });
  } catch (error) {
    return handleChatError(error);
  }
}
