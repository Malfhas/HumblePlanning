import { pgTable, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const vehicleTypes = pgTable("vehicle_types", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  icon: varchar("icon", { length: 10 }).notNull().default("Truck"),
  color: varchar("color", { length: 7 }).notNull().default("#3b82f6"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
