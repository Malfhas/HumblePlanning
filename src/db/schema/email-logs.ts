import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const emailLogs = pgTable("email_logs", {
  id: uuid().primaryKey().defaultRandom(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }),
  status: varchar("status", { length: 10 }).notNull(), // 'success' | 'error'
  error: text("error"),
  provider: varchar("provider", { length: 20 }), // 'smtp' | 'mailgun'
}, (t) => [
  index("email_logs_sent_at_idx").on(t.sentAt),
]);
