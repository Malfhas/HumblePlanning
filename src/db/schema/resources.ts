import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { resourceTypes } from "./resource-types";
import { businessUnits } from "./business-units";

export const resources = pgTable("resources", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  resourceTypeId: uuid("resource_type_id").references(() => resourceTypes.id, { onDelete: "set null" }),
  businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
  serialNumber: varchar("serial_number", { length: 50 }),
  color: varchar("color", { length: 7 }).notNull().default("#3b82f6"),
  status: varchar("status", { length: 20 }).notNull().default("available"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
