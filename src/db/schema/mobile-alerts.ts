import { pgTable, uuid, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

// Alerts for the mobile app, kept for a week: pushed by Firebase when it is
// configured, otherwise picked up by the app (Socket.io, background polling).
export const mobileAlerts = pgTable("mobile_alerts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message").notNull(),
  actionUrl: varchar("action_url", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("mobile_alerts_user_created_idx").on(t.userId, t.createdAt),
]);
