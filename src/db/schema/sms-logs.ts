import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const smsLogs = pgTable("sms_logs", {
  id: uuid().primaryKey().defaultRandom(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  recipient: varchar("recipient", { length: 30 }).notNull(), // E.164 phone
  status: varchar("status", { length: 10 }).notNull(), // 'success' | 'error'
  error: text("error"),
  provider: varchar("provider", { length: 20 }).default("sent.dm"),
}, (t) => [
  index("sms_logs_sent_at_idx").on(t.sentAt),
]);
