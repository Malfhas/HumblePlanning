import { pgTable, uuid, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { laborTypes } from "./labor-types";

export const projectLaborBudgets = pgTable("project_labor_budgets", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  laborTypeId: uuid("labor_type_id").references(() => laborTypes.id, { onDelete: "cascade" }).notNull(),
  plannedHours: decimal("planned_hours", { precision: 10, scale: 2 }).notNull(),
  consumedHours: decimal("consumed_hours", { precision: 10, scale: 2 }).notNull().default("0"),
}, (t) => [
  uniqueIndex("project_labor_budget_unique").on(t.projectId, t.laborTypeId),
]);
