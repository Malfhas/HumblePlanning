import { pgTable, uuid, varchar, date, timestamp } from "drizzle-orm/pg-core";

export const holidays = pgTable("holidays", {
  id: uuid().primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  label: varchar("label", { length: 100 }),
  color: varchar("color", { length: 7 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
