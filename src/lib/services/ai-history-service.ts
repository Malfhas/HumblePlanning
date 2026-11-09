/**
 * AI assistant history (administration): who asked what, with which model,
 * at what cost. Conversations deleted by their user (soft delete) stay
 * visible here until a purge, to understand an answer or an unexpected write
 * after the fact.
 *
 * Filters select conversations (last activity in the period, user, a model
 * used in at least one reply); totals are those of the selected conversations.
 */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { aiChatConversations, aiChatMessages, aiChatQuotaLedger, aiChatToolCalls, users } from "@/db/schema";
import { getAiChatConfig } from "@/lib/ai-chat/config";
import { ledgerPurgeThreshold, periodStart } from "@/lib/ai-chat/quota";
import { fillDailySeries, localDay } from "@/lib/ai-chat/history-series";
import { getInstanceTimezone } from "@/lib/services/config-service";

export interface AiHistoryFilters {
  since: Date | null;
  userIds: string[];
  models: string[];
}

const conv = aiChatConversations;
const msg = aiChatMessages;

function conversationConditions(filters: AiHistoryFilters): SQL | undefined {
  return and(
    filters.since ? gte(conv.updatedAt, filters.since) : undefined,
    filters.userIds.length ? inArray(conv.userId, filters.userIds) : undefined,
    filters.models.length
      ? inArray(conv.id, db.selectDistinct({ id: msg.conversationId }).from(msg).where(inArray(msg.model, filters.models)))
      : undefined,
  );
}

const fullName = sql<string>`trim(concat_ws(' ', ${users.firstName}, ${users.name}))`;

const conversationColumns = {
  id: conv.id,
  title: conv.title,
  updatedAt: conv.updatedAt,
  deletedAt: conv.deletedAt,
  userId: conv.userId,
  userName: fullName,
  messages: sql<number>`count(${msg.id})::int`,
  promptTokens: sql<number>`coalesce(sum(${msg.promptTokens}), 0)::int`,
  completionTokens: sql<number>`coalesce(sum(${msg.completionTokens}), 0)::int`,
  costUsd: sql<string>`coalesce(sum(${msg.costUsd}), 0)::text`,
  errors: sql<number>`count(${msg.error})::int`,
  // Models really used (a conversation can mix several), not the one it started with
  models: sql<string[]>`coalesce(array_agg(distinct ${msg.model}) filter (where ${msg.model} is not null), '{}')`,
};

function conversationsQuery(filters: AiHistoryFilters) {
  return db
    .select(conversationColumns)
    .from(conv)
    .leftJoin(users, eq(users.id, conv.userId))
    .leftJoin(msg, eq(msg.conversationId, conv.id))
    .where(conversationConditions(filters))
    .groupBy(conv.id, users.id)
    .orderBy(desc(conv.updatedAt), desc(conv.id));
}

export type AiHistoryConversation = Awaited<ReturnType<typeof conversationsQuery>>[number];

export async function listAiConversations(filters: AiHistoryFilters, page: number, limit: number) {
  const [data, [{ total }]] = await Promise.all([
    conversationsQuery(filters).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(conv).where(conversationConditions(filters)),
  ]);
  return { data, total, page, limit };
}

/** The whole filtered list (CSV export), bounded. */
export async function exportAiConversations(filters: AiHistoryFilters, max = 10_000) {
  return conversationsQuery(filters).limit(max);
}

/** Indicators and cost per day (instance time zone) of the filtered conversations. */
export async function getAiHistorySummary(filters: AiHistoryFilters) {
  const timeZone = await getInstanceTimezone();
  const selected = db.select({ id: conv.id }).from(conv).where(conversationConditions(filters));
  const day = sql<string>`to_char(${msg.createdAt} at time zone ${timeZone}, 'YYYY-MM-DD')`;
  const [[conversations], [totals], perDay] = await Promise.all([
    db.select({ total: count() }).from(conv).where(conversationConditions(filters)),
    db
      .select({
        messages: count(),
        promptTokens: sql<number>`coalesce(sum(${msg.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${msg.completionTokens}), 0)::int`,
        costUsd: sql<string>`coalesce(sum(${msg.costUsd}), 0)::text`,
        errors: sql<number>`count(${msg.error})::int`,
        averageDurationMs: sql<number>`coalesce(round(avg(${msg.durationMs})), 0)::int`,
      })
      .from(msg)
      .where(inArray(msg.conversationId, selected)),
    db
      .select({ day, costUsd: sql<string>`coalesce(sum(${msg.costUsd}), 0)::text` })
      .from(msg)
      .where(and(inArray(msg.conversationId, selected), filters.since ? gte(msg.createdAt, filters.since) : undefined))
      // By position: the time zone is bound once per occurrence of `day`, Postgres
      // would not see the GROUP BY expression as the selected one
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);
  const costs = perDay.map((row) => ({ day: row.day, costUsd: Number(row.costUsd) }));
  const firstDay = filters.since ? localDay(filters.since, timeZone) : costs[0]?.day;
  return {
    kpis: { conversations: conversations.total, ...totals, costUsd: Number(totals.costUsd) },
    costByDay: firstDay ? fillDailySeries(costs, firstDay, localDay(new Date(), timeZone)) : [],
    timeZone,
  };
}

/** Values of the user and model filters: those present in the history. */
export async function getAiHistoryFilterOptions() {
  const [people, models] = await Promise.all([
    db
      .selectDistinct({ id: users.id, name: fullName })
      .from(conv)
      .innerJoin(users, eq(users.id, conv.userId))
      .orderBy(fullName),
    db.selectDistinct({ model: msg.model }).from(msg).where(isNotNull(msg.model)).orderBy(msg.model),
  ]);
  return { users: people, models: models.map((row) => row.model as string) };
}

/** A conversation with its messages and tool calls, or null. */
export async function getAiConversationDetail(id: string) {
  const [conversation] = await db
    .select({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      deletedAt: conv.deletedAt,
      userName: fullName,
    })
    .from(conv)
    .leftJoin(users, eq(users.id, conv.userId))
    .where(eq(conv.id, id))
    .limit(1);
  if (!conversation) return null;
  const messages = await db
    .select({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      model: msg.model,
      status: msg.status,
      error: msg.error,
      costUsd: msg.costUsd,
      promptTokens: msg.promptTokens,
      completionTokens: msg.completionTokens,
      durationMs: msg.durationMs,
      createdAt: msg.createdAt,
    })
    .from(msg)
    .where(eq(msg.conversationId, id))
    .orderBy(asc(msg.createdAt));
  const toolCalls = messages.length
    ? await db
        .select({
          id: aiChatToolCalls.id,
          messageId: aiChatToolCalls.messageId,
          tool: aiChatToolCalls.tool,
          status: aiChatToolCalls.status,
          arguments: aiChatToolCalls.arguments,
          result: aiChatToolCalls.result,
          error: aiChatToolCalls.error,
          createdAt: aiChatToolCalls.createdAt,
        })
        .from(aiChatToolCalls)
        .where(inArray(aiChatToolCalls.messageId, messages.map((m) => m.id)))
        .orderBy(asc(aiChatToolCalls.createdAt))
    : [];
  return {
    ...conversation,
    messages: messages.map((m) => ({ ...m, toolCalls: toolCalls.filter((call) => call.messageId === m.id) })),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Purge (manual « before the » and nightly retention)
// ════════════════════════════════════════════════════════════════════════

/**
 * Up to where the quota ledger may go: never into the current quota period
 * (global start: configured day or global reset), whatever the date asked.
 */
async function ledgerLimit(before: Date): Promise<Date> {
  const settings = (await getAiChatConfig()).quota;
  const start = periodStart({
    now: new Date(),
    day: settings.resetDay,
    resetAt: settings.resetAt ? new Date(settings.resetAt) : null,
    userResetAt: null,
    timeZone: await getInstanceTimezone(),
  });
  return ledgerPurgeThreshold(before, start);
}

/** What a purge « before » would erase: conversations by last activity, their messages, the ledger rows. */
export async function previewAiHistoryPurge(before: Date) {
  const stale = db.select({ id: conv.id }).from(conv).where(lt(conv.updatedAt, before));
  const [[conversations], [messages], [ledger]] = await Promise.all([
    db.select({ total: count() }).from(conv).where(lt(conv.updatedAt, before)),
    db.select({ total: count() }).from(msg).where(inArray(msg.conversationId, stale)),
    db.select({ total: count() }).from(aiChatQuotaLedger).where(lt(aiChatQuotaLedger.createdAt, await ledgerLimit(before))),
  ]);
  return { conversations: conversations.total, messages: messages.total, ledgerEntries: ledger.total };
}

/**
 * Erases the conversations whose last activity is before `before` (messages
 * and tool calls follow by cascade) and the quota ledger rows outside the
 * current quota period.
 */
export async function purgeAiHistory(before: Date) {
  const preview = await previewAiHistoryPurge(before);
  const limit = await ledgerLimit(before);
  const [conversations, ledger] = await db.transaction(async (tx) => [
    await tx.delete(conv).where(lt(conv.updatedAt, before)).returning({ id: conv.id }),
    await tx.delete(aiChatQuotaLedger).where(lt(aiChatQuotaLedger.createdAt, limit)).returning({ id: aiChatQuotaLedger.id }),
  ]);
  return { conversations: conversations.length, messages: preview.messages, ledgerEntries: ledger.length };
}
