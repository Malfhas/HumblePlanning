import { pgTable, uuid, varchar, date, text, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { vehicles } from "./vehicles";
import { tasks } from "./tasks";
import { projects } from "./projects";
import { users } from "./users";

export const vehicleAssignments = pgTable("vehicle_assignments", {
  id: uuid().primaryKey().defaultRandom(),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }).notNull(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  startTime: varchar("start_time", { length: 5 }),
  endTime: varchar("end_time", { length: 5 }),
  assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
  lastModifierId: uuid("last_modifier_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  type: varchar("type", { length: 20 }).notNull().default("task"),
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("vehicle_assignments_vehicle_idx").on(t.vehicleId),
  index("vehicle_assignments_task_idx").on(t.taskId),
  index("vehicle_assignments_date_idx").on(t.startDate, t.endDate),
]);
