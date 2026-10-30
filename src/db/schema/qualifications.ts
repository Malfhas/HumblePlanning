import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const qualifications = pgTable("qualifications", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  emoji: varchar("emoji", { length: 10 }).notNull().default("Award"),
  color: varchar("color", { length: 7 }).notNull().default("#ffffff"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
