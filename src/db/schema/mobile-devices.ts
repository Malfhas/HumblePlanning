import { pgTable, uuid, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { sessions } from "./auth";

// Devices signed in through the mobile app: one row per session, so revoking
// the session (profile, password change, sign-out) also drops its push token.
export const mobileDevices = pgTable("mobile_devices", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull().unique(),
  platform: varchar("platform", { length: 20 }).notNull().default("android"),
  deviceName: varchar("device_name", { length: 100 }),
  appVersion: varchar("app_version", { length: 30 }),
  locale: varchar("locale", { length: 10 }),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("mobile_devices_user_id_idx").on(t.userId),
]);
