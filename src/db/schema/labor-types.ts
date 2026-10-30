import { pgTable, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const laborTypes = pgTable("labor_types", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  initials: varchar("initials", { length: 10 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
