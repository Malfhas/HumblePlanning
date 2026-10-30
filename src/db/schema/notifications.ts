import { pgTable, uuid, varchar, text, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users";

export const notifications = pgTable("notifications", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  // Text frozen in the recipient's language at creation: fallback for
  // old rows, the API and clients that ignore the keys below.
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message").notNull(),
  // Translatable version: message key + RAW parameters (ISO dates),
  // translated at display time into the reader's language (useNotificationText).
  titleKey: varchar("title_key", { length: 100 }),
  messageKey: varchar("message_key", { length: 100 }),
  params: jsonb("params").$type<Record<string, string | number>>(),
  actionUrl: varchar("action_url", { length: 500 }),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("notif_user_created_idx").on(t.userId, t.createdAt),
]);
