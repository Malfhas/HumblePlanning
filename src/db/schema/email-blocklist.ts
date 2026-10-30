import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const emailBlocklist = pgTable("email_blocklist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  reason: varchar("reason", { length: 20 }).notNull(), // "bounce" | "complaint" | "manual"
  reasonDetail: text("reason_detail"),
  source: varchar("source", { length: 20 }).notNull().default("nuntly"),
  blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
  blockedBy: uuid("blocked_by"),
}, (t) => [
  index("email_blocklist_email_idx").on(t.email),
  index("email_blocklist_blocked_at_idx").on(t.blockedAt),
]);
