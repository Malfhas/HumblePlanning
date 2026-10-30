import { pgTable, uuid, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users";

export type FilterConfig = {
  userIds?: string[];
  projectIds?: string[];
  statusIds?: string[];
  businessUnitIds?: string[];
  siteAddressIds?: string[];
  resourceIds?: string[];
  vehicleIds?: string[];
  qualificationIds?: string[];
  groupIds?: string[];
  search?: string;
  dateRange?: { start: string; end: string };
};

export const savedFilters = pgTable("saved_filters", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  module: varchar("module", { length: 50 }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  filters: jsonb("filters").$type<FilterConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
