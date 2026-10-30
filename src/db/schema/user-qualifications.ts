import { pgTable, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { qualifications } from "./qualifications";

export const userQualifications = pgTable("user_qualifications", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  qualificationId: uuid("qualification_id").references(() => qualifications.id, { onDelete: "cascade" }).notNull(),
}, (t) => [
  uniqueIndex("user_qualifications_user_qual_idx").on(t.userId, t.qualificationId),
  index("user_qualifications_user_idx").on(t.userId),
  index("user_qualifications_qual_idx").on(t.qualificationId),
]);
