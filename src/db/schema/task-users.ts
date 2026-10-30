import { pgTable, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tasks } from "./tasks";
import { users } from "./users";

export const taskUsers = pgTable("task_users", {
  id: uuid().primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
}, (t) => [
  uniqueIndex("task_users_task_user_idx").on(t.taskId, t.userId),
  index("task_users_task_idx").on(t.taskId),
  index("task_users_user_idx").on(t.userId),
]);
