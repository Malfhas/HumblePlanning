import { db } from "@/db";
import { emailBlocklist, users } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { getConfigValue } from "./config-service";
import { logAudit } from "./audit-service";

export interface BlocklistEntry {
  id: string;
  email: string;
  reason: string;
  reasonDetail: string | null;
  source: string;
  blockedAt: Date;
  blockedBy: string | null;
}

export interface BlocklistEntryWithUser extends BlocklistEntry {
  userId: string | null;
  userLogin: string | null;
  userName: string | null;
}

/**
 * Returns true if the blocklist is currently active (provider must be Nuntly).
 * When inactive, blocked emails remain in DB but are NOT enforced anywhere.
 */
export async function isBlocklistActive(): Promise<boolean> {
  const provider = (await getConfigValue("EMAIL_PROVIDER")) || "nuntly";
  return provider === "nuntly";
}

/**
 * Check if an email address is blocked AND blocklist is active.
 * Returns false if email is blocked but provider is not Nuntly.
 */
export async function isEmailBlocked(email: string): Promise<boolean> {
  if (!email) return false;
  if (!(await isBlocklistActive())) return false;
  const [row] = await db
    .select({ id: emailBlocklist.id })
    .from(emailBlocklist)
    .where(eq(emailBlocklist.email, email.toLowerCase()))
    .limit(1);
  return !!row;
}

/**
 * Get all blocked emails with their linked user (if any).
 */
export async function getBlockedEmails(): Promise<BlocklistEntryWithUser[]> {
  const rows = await db
    .select({
      id: emailBlocklist.id,
      email: emailBlocklist.email,
      reason: emailBlocklist.reason,
      reasonDetail: emailBlocklist.reasonDetail,
      source: emailBlocklist.source,
      blockedAt: emailBlocklist.blockedAt,
      blockedBy: emailBlocklist.blockedBy,
      userId: users.id,
      userLogin: users.username,
      userName: users.name,
    })
    .from(emailBlocklist)
    .leftJoin(users, eq(sql`LOWER(${users.email})`, emailBlocklist.email)) // i18n-ignore SQL
    .orderBy(desc(emailBlocklist.blockedAt));
  return rows;
}

/**
 * Add an email to the blocklist. Idempotent (no-op if already present).
 */
export async function blockEmail(
  email: string,
  reason: "bounce" | "complaint" | "manual",
  reasonDetail?: string,
  source: string = "nuntly",
  blockedBy?: string,
): Promise<void> {
  const normalized = email.toLowerCase();
  await db
    .insert(emailBlocklist)
    .values({ email: normalized, reason, reasonDetail, source, blockedBy })
    .onConflictDoNothing();
}

/**
 * Remove an email from the blocklist by ID. Logs an audit event.
 */
export async function unblockEmail(id: string, unblockerId: string): Promise<void> {
  const [entry] = await db
    .select()
    .from(emailBlocklist)
    .where(eq(emailBlocklist.id, id))
    .limit(1);
  if (!entry) return;

  await db.delete(emailBlocklist).where(eq(emailBlocklist.id, id));

  await logAudit({
    userId: unblockerId,
    action: "email_unblocked",
    entityType: "email",
    entityId: null,
    metadata: { email: entry.email, reason: entry.reason, source: entry.source },
  });
}
