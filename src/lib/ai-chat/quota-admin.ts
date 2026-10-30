import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiChatQuotaOverrides, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { INTL_TAG } from "@/i18n/config";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getAiChatConfig, type AiChatQuotaSettings } from "./config";
import { getInstanceTimezone } from "@/lib/services/config-service";
import { usageByUser } from "./quota-service";
import { nextReset, periodStart, quotaPercentage } from "./quota";

/** Settings as the admin screen reads them. */
export const quotaSettingsView = (q: AiChatQuotaSettings) => ({
  enabled: q.enabled,
  amountUsd: q.monthlyUsd,
  resetDay: q.resetDay,
  resetAt: q.resetAt,
});

/**
 * Settings as written to the audit log. These keys are stored data (names
 * from the original project): older entries use them, so they never change.
 */
export const quotaSettingsAuditValues = (q: AiChatQuotaSettings) => ({
  actif: q.enabled,
  montantUsd: q.monthlyUsd,
  jourReinitialisation: q.resetDay,
  reinitialiseLe: q.resetAt,
});

/**
 * AI chat quotas: the settings, and the usage of each active account over
 * the current period, biggest consumers first. Amounts are only visible
 * here: the user only gets a gauge.
 */
export async function getAdminQuotaState() {
  const settings = (await getAiChatConfig()).quota;
  const timeZone = await getInstanceTimezone();
  const sortLocale = INTL_TAG[await resolveRequestLocale()];
  const now = new Date();
  // Start shared by all; an account-specific reset is applied in the query
  const start = periodStart({
    now,
    day: settings.resetDay,
    resetAt: settings.resetAt ? new Date(settings.resetAt) : null,
    userResetAt: null,
    timeZone,
  });
  const [accounts, usage] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        firstName: users.firstName,
        email: users.email,
        unlimited: aiChatQuotaOverrides.unlimited,
        resetAt: aiChatQuotaOverrides.resetAt,
      })
      .from(users)
      .leftJoin(aiChatQuotaOverrides, eq(aiChatQuotaOverrides.userId, users.id))
      .where(eq(users.active, true)),
    usageByUser(start),
  ]);
  const accountUsage = accounts
    .map((account) => {
      const usageUsd = usage.get(account.id) ?? 0;
      return {
        id: account.id,
        name: [account.firstName, account.name].filter(Boolean).join(" "),
        email: account.email ?? "",
        usageUsd,
        percent: quotaPercentage(usageUsd, settings.monthlyUsd),
        unlimited: Boolean(account.unlimited),
        resetAt: account.resetAt ? account.resetAt.toISOString() : null,
      };
    })
    .sort((a, b) => b.usageUsd - a.usageUsd || a.name.localeCompare(b.name, sortLocale));
  return {
    settings: quotaSettingsView(settings),
    periodStart: start.toISOString(),
    nextReset: nextReset(now, settings.resetDay, timeZone).toISOString(),
    users: accountUsage,
  };
}

export async function getQuotaAccount(userId: string) {
  const [account] = await db
    .select({ id: users.id, email: users.email, name: users.name, unlimited: aiChatQuotaOverrides.unlimited })
    .from(users)
    .leftJoin(aiChatQuotaOverrides, eq(aiChatQuotaOverrides.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) throw new AppError("aiChat.errors.userNotFound");
  return account;
}

export async function upsertQuotaOverride(userId: string, values: { unlimited?: boolean; resetAt?: Date }) {
  await db
    .insert(aiChatQuotaOverrides)
    .values({ userId, unlimited: values.unlimited ?? false, resetAt: values.resetAt ?? null })
    .onConflictDoUpdate({
      target: aiChatQuotaOverrides.userId,
      set: {
        ...(values.unlimited !== undefined ? { unlimited: values.unlimited } : {}),
        ...(values.resetAt !== undefined ? { resetAt: values.resetAt } : {}),
        updatedAt: new Date(),
      },
    });
}
