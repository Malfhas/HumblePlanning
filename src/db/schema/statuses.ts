import { pgTable, uuid, varchar, boolean, smallint, integer, timestamp } from "drizzle-orm/pg-core";

export const statuses = pgTable("statuses", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }),
  displayMode: varchar("display_mode", { length: 5 }).default("tp"),
  strikethrough: boolean("strikethrough").default(false),
  bold: boolean("bold").default(false),
  italic: boolean("italic").default(false),
  underline: boolean("underline").default(false),
  isDefault: boolean("is_default").default(false),
  showInList: boolean("show_in_list").default(true),
  percentage: smallint("percentage").default(0),
  priority: smallint("priority").default(5),
  includeInCalculation: boolean("include_in_calculation").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
