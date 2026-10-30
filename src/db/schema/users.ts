import { pgTable, uuid, varchar, text, boolean, decimal, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { roles } from "./roles";
import { businessUnits } from "./business-units";
import { laborTypes } from "./labor-types";

export type UserPreferences = {
  defaultView?: "users" | "projects" | "places" | "resources";
  columnView?: "days" | "hours";
  cellSize?: "compact" | "normal" | "large";
  hideEmptyRows?: boolean;
  showSummaryTable?: boolean;
  scrollMode?: "H" | "HV" | "NONE";
  dateFormat?: "fr" | "us" | "iso";
  planningPosition?: "today" | "saved";
  defaultHomePage?: string;
  theme?: string;
  // The language is NOT a preference stored here: browser choice
  // (HP_LOCALE cookie) and last effective language in the `locale` column.
};

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
  businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
  laborTypeId: uuid("labor_type_id").references(() => laborTypes.id, { onDelete: "set null" }),
  name: varchar("name", { length: 100 }).notNull(),
  firstName: varchar("first_name", { length: 100 }),
  username: varchar("login", { length: 100 }).unique(),
  email: varchar("email", { length: 255 }).unique(),
  emailVerified: boolean("email_verified").default(false),
  image: text("image"),
  color: varchar("color", { length: 7 }).default("#FFFFFF"),
  preferences: jsonb("preferences").$type<UserPreferences>().default({}),
  visibleOnPlanning: boolean("visible_on_planning").default(true),
  notifications: boolean("notifications").default(false),
  pushNotifications: boolean("push_notifications").default(false),
  smsNotifications: boolean("sms_notifications").default(false),
  notificationsUser: boolean("notifications_user").notNull().default(true),
  pushNotificationsUser: boolean("push_notifications_user").notNull().default(true),
  smsNotificationsUser: boolean("sms_notifications_user").notNull().default(true),
  address: varchar("address", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  mobile: varchar("mobile", { length: 20 }),
  job: varchar("job", { length: 100 }),
  comment: text("comment"),
  contractType: varchar("contract_type", { length: 30 }),
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true),
  forcePasswordChange: boolean("force_password_change").notNull().default(false),
  forceTwoFactor: boolean("force_two_factor").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  twoFactorSecret: text("two_factor_secret"),
  twoFactorBackupCodes: text("two_factor_backup_codes"),
  icalToken: uuid("ical_token"),
  defaultHourlyRate: decimal("default_hourly_rate", { precision: 10, scale: 2 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // User's last effective language (a LOCALES code), updated on
  // sign-in, on language change and when the dashboard loads. Used for
  // emails / notifications. null = never known (instance language).
  locale: varchar("locale", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
