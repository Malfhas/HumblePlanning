import { pgTable, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { businessUnits } from "./business-units";

export const projectGroups = pgTable("project_groups", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).default("#6366f1"),
  sortOrder: integer("sort_order").default(0),
  businessUnitId: uuid("business_unit_id").notNull().references(() => businessUnits.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
