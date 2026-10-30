import { pgTable, uuid, varchar, text, date, time, boolean, decimal, timestamp, jsonb, integer, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";
import { statuses } from "./statuses";
import { places } from "./places";
import { resources } from "./resources";

export const tasks = pgTable("tasks", {
  id: uuid().primaryKey().defaultRandom(),
  parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
  linkId: varchar("link_id", { length: 36 }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  duration: time("duration"),
  durationDetails: varchar("duration_details", { length: 20 }),
  startTime: time("start_time"),
  endTime: time("end_time"),
  title: varchar("title", { length: 255 }),
  notes: text("notes"),
  link: text("link"),
  statusId: uuid("status_id").references(() => statuses.id).notNull(),
  placeId: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
  resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
  isLocked: boolean("is_locked").notNull().default(false),
  isMilestone: boolean("is_milestone").default(false),
  files: jsonb("files").$type<{ id: string; name: string; originalName: string; size: number; mimeType: string; uploadedAt: string; uploadedBy?: string }[]>().default([]),
  placeText: varchar("place_text", { length: 255 }),
  placeTextLat: decimal("place_text_lat", { precision: 10, scale: 7 }),
  placeTextLng: decimal("place_text_lng", { precision: 10, scale: 7 }),
  customField: varchar("custom_field", { length: 255 }),
  breakDuration: time("break_duration"),
  realDuration: decimal("real_duration", { precision: 10, scale: 2 }),
  creatorId: uuid("creator_id").references(() => users.id),
  lastModifierId: uuid("last_modifier_id").references(() => users.id),
  recurType: varchar("recur_type", { length: 10 }),
  recurFrequency: integer("recur_frequency"),
  recurEndDate: date("recur_end_date"),
  recurDayOfWeek: integer("recur_day_of_week"),
  recurException: varchar("recur_exception", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("tasks_project_idx").on(t.projectId),
  index("tasks_date_range_idx").on(t.startDate, t.endDate),
  index("tasks_parent_idx").on(t.parentId),
  index("tasks_link_idx").on(t.linkId),
  // Composite (project_id, start_date): serves the schedule joins
  // that filter on businessUnit (subquery on projects) + date range.
  // Before: partial seq scan over ~30k tasks for most ranges.
  index("tasks_project_start_idx").on(t.projectId, t.startDate),
  // Covers the ORDER BY desc(updatedAt), desc(startDate), asc(id) that
  // forced an in-memory Sort (~30 ms over 30k sorted rows). With a
  // covering index, PostgreSQL does a direct ordered Index Scan.
  index("tasks_updated_start_id_idx").on(t.updatedAt, t.startDate, t.id),
]);
