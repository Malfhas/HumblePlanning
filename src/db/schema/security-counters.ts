import { pgTable, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";

// Security counters (login and 2FA lockouts, password reset cooldowns, rate
// limits of the public OAuth endpoints): shared by every process and kept
// across restarts. One row per key, only written by the atomic upsert of
// security-counter-service.ts; expired rows are pruned there.
export const securityCounters = pgTable("security_counters", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  // After this date the row no longer matters (window and lock are over)
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("security_counters_expires_at_idx").on(t.expiresAt),
]);
