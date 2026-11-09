import { pgTable, uuid, varchar, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Warnings and errors written by the logger (src/lib/logger.ts), grouped:
 * one row per fingerprint (level + category + normalized message), with an
 * occurrence counter. The route, method, user, metadata and stack are those
 * of the last occurrence. INFO and DEBUG never reach this table (stdout only).
 */
export const systemEvents = pgTable("system_events", {
  id: uuid().primaryKey().defaultRandom(),
  level: varchar("level", { length: 8 }).$type<"ERROR" | "WARN">().notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  stack: text("stack"),
  route: varchar("route", { length: 500 }),
  method: varchar("method", { length: 10 }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  occurrences: integer("occurrences").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("system_events_fingerprint_idx").on(t.fingerprint),
  index("system_events_last_seen_idx").on(t.lastSeenAt),
]);
