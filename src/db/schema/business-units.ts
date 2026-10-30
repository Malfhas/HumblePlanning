import { pgTable, uuid, varchar, decimal, timestamp } from "drizzle-orm/pg-core";

export const businessUnits = pgTable("business_units", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#8b5cf6"),
  number: varchar("number", { length: 50 }).notNull(),
  address: varchar("address", { length: 500 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
