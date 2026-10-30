import { db } from "@/db";
import { passwordHistory } from "@/db/schema/password-history";
import { eq, desc } from "drizzle-orm";
import { verifyPassword } from "@/lib/password";
import { getConfigValues } from "./config-service";

/**
 * Check if a clear-text password matches any of the user's last N passwords.
 * Returns true if the password was recently used (and should be rejected).
 * If PWD_HISTORY_COUNT is 0, always returns false (no restriction).
 */
export async function isPasswordReused(userId: string, clearPassword: string): Promise<boolean> {
  const config = await getConfigValues(["PWD_HISTORY_COUNT"]);
  const historyCount = parseInt(config.PWD_HISTORY_COUNT ?? "0") || 0;

  if (historyCount <= 0) return false;

  // Get the last N password hashes for this user
  const history = await db
    .select({ passwordHash: passwordHistory.passwordHash })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(historyCount);

  // Verify against each stored hash
  for (const entry of history) {
    const match = await verifyPassword({ password: clearPassword, hash: entry.passwordHash });
    if (match) return true;
  }

  return false;
}

/**
 * Check if a clear-text password is in the blacklist.
 * Returns true if the password is blacklisted (and should be rejected).
 */
export async function isPasswordBlacklisted(clearPassword: string): Promise<boolean> {
  const config = await getConfigValues(["PWD_BLACKLIST_ENABLED", "PWD_BLACKLIST"]);

  if (config.PWD_BLACKLIST_ENABLED !== "true") return false;

  const blacklist = (config.PWD_BLACKLIST ?? "").split(",").filter(Boolean);
  if (blacklist.length === 0) return false;

  return blacklist.includes(clearPassword.toLowerCase());
}

/**
 * Record a password hash in the user's history.
 * Also trims old entries beyond the configured limit.
 */
export async function addPasswordToHistory(userId: string, hashedPassword: string): Promise<void> {
  await db.insert(passwordHistory).values({
    userId,
    passwordHash: hashedPassword,
  });

  // Trim old entries: keep only the max configured amount (or 20 as absolute cap)
  const config = await getConfigValues(["PWD_HISTORY_COUNT"]);
  const historyCount = parseInt(config.PWD_HISTORY_COUNT ?? "0") || 0;
  const keepCount = Math.max(historyCount, 20); // Keep at least enough for future policy changes

  const allEntries = await db
    .select({ id: passwordHistory.id })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt));

  if (allEntries.length > keepCount) {
    const idsToDelete = allEntries.slice(keepCount).map((e) => e.id);
    for (const entryId of idsToDelete) {
      await db.delete(passwordHistory).where(eq(passwordHistory.id, entryId));
    }
  }
}
