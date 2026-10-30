import { pgTable, uuid, varchar, text, date, decimal, timestamp, integer, index } from "drizzle-orm/pg-core";
import { projectGroups } from "./project-groups";
import { users } from "./users";
import { businessUnits } from "./business-units";

export const projects = pgTable("projects", {
  id: uuid().primaryKey().defaultRandom(),
  businessNumber: varchar("business_number", { length: 50 }),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#FFFFFF"),
  status: varchar("status", { length: 20 }).notNull().default("todo"),
  sortOrder: integer("sort_order").default(0),
  groupId: uuid("group_id").references(() => projectGroups.id, { onDelete: "set null" }),
  businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id").references(() => users.id).notNull(),
  deliveryDate: date("delivery_date"),
  link: text("link"),
  description: text("description"),
  iteration: varchar("iteration", { length: 255 }),
  budgetAmount: decimal("budget_amount", { precision: 12, scale: 2 }),
  budgetTime: decimal("budget_time", { precision: 10, scale: 2 }),
  amountConsumed: decimal("amount_consumed", { precision: 12, scale: 2 }).default("0"),
  timeConsumed: decimal("time_consumed", { precision: 10, scale: 2 }).default("0"),
  amountRemaining: decimal("amount_remaining", { precision: 12, scale: 2 }),
  timeRemaining: decimal("time_remaining", { precision: 10, scale: 2 }),
  address: varchar("address", { length: 500 }),
  addressLat: decimal("address_lat", { precision: 10, scale: 7 }),
  addressLng: decimal("address_lng", { precision: 10, scale: 7 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // Serves the schedule joins: `/api/tasks` filters tasks via
  // a subquery `WHERE project_id IN (SELECT id FROM projects WHERE
  // business_unit_id IN (...))`. Without this index, a full seq scan of
  // the projects table on every schedule request.
  index("projects_business_unit_idx").on(t.businessUnitId),
  // Frequent sort (project list, dashboard) by group + internal order.
  index("projects_group_sort_idx").on(t.groupId, t.sortOrder),
]);
