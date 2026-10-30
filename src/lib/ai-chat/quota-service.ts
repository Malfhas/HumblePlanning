import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiChatQuotaLedger, aiChatQuotaOverrides } from "@/db/schema";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getAiChatConfig, type AiChatQuotaSettings } from "./config";
import { getInstanceTimezone } from "@/lib/services/config-service";
import { nextReset, periodStart, quotaPercentage, quotaReachedError } from "./quota";

/** What the screen knows about a user's quota: never an amount. */
export interface QuotaState {
  /** False when the quota is disabled or the amount is zero: no gauge. */
  enabled: boolean;
  unlimited: boolean;
  /** From 0 to 100, integer. */
  percent: number;
  reached: boolean;
  /** Next occurrence of the configured day, in ISO. */
  resetsAt: string;
}

/**
 * Monthly AI chat quota, shared by design between the Assistant page and the
 * floating sphere: both feed the same ledger (one row per reply with a known
 * cost), and usage is the sum of this ledger over the period. It lives apart
 * from conversations: deleting one refunds nothing. Nothing is counted on the
 * fly: each read aggregates the current period, which makes the computation
 * immune to restarts.
 */

export async function quotaOverrideOf(userId: string) {
  const [row] = await db.select().from(aiChatQuotaOverrides).where(eq(aiChatQuotaOverrides.userId, userId)).limit(1);
  return row ?? null;
}

/** This user's quota state, as the access route returns it. */
export async function getQuotaState(
  userId: string,
  context?: { settings?: AiChatQuotaSettings; timeZone?: string },
): Promise<QuotaState> {
  const settings = context?.settings ?? (await getAiChatConfig()).quota;
  const timeZone = context?.timeZone ?? (await getInstanceTimezone());
  const now = new Date();
  const override = await quotaOverrideOf(userId);
  const base = {
    enabled: settings.enabled && settings.monthlyUsd > 0,
    unlimited: Boolean(override?.unlimited),
    resetsAt: nextReset(now, settings.resetDay, timeZone).toISOString(),
  };
  if (!base.enabled) return { ...base, percent: 0, reached: false };

  const start = periodStart({
    now,
    day: settings.resetDay,
    resetAt: settings.resetAt ? new Date(settings.resetAt) : null,
    userResetAt: override?.resetAt ?? null,
    timeZone,
  });
  const usage = (await usageByUser(start, userId)).get(userId) ?? 0;
  return {
    ...base,
    percent: quotaPercentage(usage, settings.monthlyUsd),
    reached: usage >= settings.monthlyUsd,
  };
}

/**
 * Rejects a new question when the quota is reached. Called BEFORE any write
 * and before any provider call: a reply in progress is never interrupted,
 * it is the next question that gets rejected.
 */
export async function assertQuotaNotReached(userId: string): Promise<void> {
  const timeZone = await getInstanceTimezone();
  const state = await getQuotaState(userId, { timeZone });
  if (state.enabled && state.reached && !state.unlimited) {
    throw quotaReachedError(new Date(state.resetsAt), timeZone, await resolveRequestLocale());
  }
}

/**
 * Usage over the period, per user, in a single query: the sum of the ledger
 * since `globalStart` (configured day or global reset), or since the
 * account-specific reset if it is more recent. Without `userId`, all
 * accounts that have used something.
 */
export async function usageByUser(globalStart: Date, userId?: string): Promise<Map<string, number>> {
  const start = globalStart.toISOString();
  const rows = await db
    .select({
      userId: aiChatQuotaLedger.userId,
      total: sql<string>`sum(${aiChatQuotaLedger.costUsd})::text`,
    })
    .from(aiChatQuotaLedger)
    .leftJoin(aiChatQuotaOverrides, eq(aiChatQuotaOverrides.userId, aiChatQuotaLedger.userId))
    .where(
      and(
        sql`${aiChatQuotaLedger.createdAt} >= greatest(${start}::timestamptz, coalesce(${aiChatQuotaOverrides.resetAt}, ${start}::timestamptz))`,
        userId ? eq(aiChatQuotaLedger.userId, userId) : undefined,
      ),
    )
    .groupBy(aiChatQuotaLedger.userId);
  return new Map(rows.map((row) => [row.userId, Number(row.total)]));
}
