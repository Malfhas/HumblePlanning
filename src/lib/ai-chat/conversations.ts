import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiChatConversations, aiChatMessages } from "@/db/schema";

/** A conversation as the screen lists it. */
export interface ListedConversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  followsNavigation: boolean;
  /** A reply is still finishing in it on the server (computed in the database). */
  replyInProgress: boolean;
  pinnedAt: string | null;
}

const columns = {
  id: aiChatConversations.id,
  title: aiChatConversations.title,
  model: aiChatConversations.model,
  updatedAt: aiChatConversations.updatedAt,
  followsNavigation: aiChatConversations.followsNavigation,
  pinnedAt: aiChatConversations.pinnedAt,
  replyInProgress: sql<boolean>`exists (select 1 from ${aiChatMessages} m where m.conversation_id = ${aiChatConversations.id} and m.status = 'RUNNING')`,
};

type Row = {
  id: string;
  title: string;
  model: string;
  updatedAt: Date;
  followsNavigation: boolean;
  pinnedAt: Date | null;
  replyInProgress: boolean;
};

const toListed = (row: Row): ListedConversation => ({
  id: row.id,
  title: row.title,
  model: row.model,
  updatedAt: row.updatedAt.toISOString(),
  followsNavigation: row.followsNavigation,
  replyInProgress: Boolean(row.replyInProgress),
  pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
});

/**
 * The user's conversations, 100 at most, most recent first.
 * Those of the floating sphere are listed separately (`followsNavigation`).
 */
export async function listConversations(userId: string, opts?: { followsNavigation?: boolean }) {
  const rows = await db
    .select(columns)
    .from(aiChatConversations)
    .where(
      and(
        eq(aiChatConversations.userId, userId),
        isNull(aiChatConversations.archivedAt),
        isNull(aiChatConversations.deletedAt),
        opts?.followsNavigation ? eq(aiChatConversations.followsNavigation, true) : undefined,
      ),
    )
    .orderBy(desc(aiChatConversations.updatedAt))
    .limit(100);
  return rows.map(toListed);
}

export async function getListedConversation(userId: string, id: string): Promise<ListedConversation | null> {
  const [row] = await db
    .select(columns)
    .from(aiChatConversations)
    .where(and(eq(aiChatConversations.id, id), eq(aiChatConversations.userId, userId), isNull(aiChatConversations.deletedAt)))
    .limit(1);
  return row ? toListed(row) : null;
}
