import { pgTable, uuid, varchar, uniqueIndex } from "drizzle-orm/pg-core";
import { roles } from "./roles";

export const rolePermissions = pgTable("role_permissions", {
  id: uuid().primaryKey().defaultRandom(),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }).notNull(),
  permission: varchar("permission", { length: 100 }).notNull(),
}, (t) => [uniqueIndex("role_perm_unique").on(t.roleId, t.permission)]);
