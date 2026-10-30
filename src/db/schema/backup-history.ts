import { pgTable, uuid, varchar, bigint, integer, boolean, timestamp, text, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const backupHistory = pgTable("backup_history", {
  id: uuid().primaryKey().defaultRandom(),
  filename: varchar("filename", { length: 255 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sizeCompressed: bigint("size_compressed", { mode: "number" }),
  durationMs: integer("duration_ms").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("in_progress"),
  errorMessage: text("error_message"),
  triggerType: varchar("trigger_type", { length: 20 }).notNull().default("manual"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  encrypted: boolean("encrypted").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("backup_created_idx").on(t.createdAt),
  index("backup_status_idx").on(t.status),
]);
