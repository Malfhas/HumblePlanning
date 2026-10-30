import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const webhookLogs = pgTable("webhook_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 20 }).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  eventId: varchar("event_id", { length: 100 }),
  recipient: varchar("recipient", { length: 255 }),
  messageId: varchar("message_id", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull(), // "received" | "processed" | "error" | "invalid_signature" | "rate_limited"
  errorMessage: text("error_message"),
  payload: jsonb("payload"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("webhook_logs_received_at_idx").on(t.receivedAt),
  index("webhook_logs_event_type_idx").on(t.eventType),
  index("webhook_logs_provider_idx").on(t.provider),
]);
