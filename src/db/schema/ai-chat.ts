import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, boolean, integer, decimal, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { projects } from "./projects";

/**
 * Built-in AI chat (assistant of the /assistant page and floating sphere).
 *
 * No pgEnum: varchars typed in TypeScript, like the rest of the schema.
 * Message order relies on `created_at` set by the database (microsecond
 * precision): never pass it a JavaScript `Date`.
 */
export type AiChatRole = "USER" | "ASSISTANT" | "TOOL";
export type AiChatMessageStatus = "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | "INTERRUPTED";
export type AiChatToolCallStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";

export const aiChatConversations = pgTable("ai_chat_conversations", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Null: "Whole schedule" scope (the projects visible to the user). */
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  /** Floating assistant conversation: the scope follows navigation. */
  followsNavigation: boolean("follows_navigation").notNull().default(false),
  title: varchar("title", { length: 200 }).notNull(),
  model: varchar("model", { length: 200 }).notNull(),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /** Deleted by the user (soft delete): the row stays in the DB. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ai_chat_conv_user_updated_idx").on(t.userId, t.updatedAt),
  index("ai_chat_conv_project_idx").on(t.projectId),
]);

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: uuid().primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => aiChatConversations.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).$type<AiChatRole>().notNull(),
  /** Empty allowed: a reply that is starting, or a tool round. */
  content: text("content").notNull(),
  model: varchar("model", { length: 200 }),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  costUsd: decimal("cost_usd", { precision: 12, scale: 6 }),
  durationMs: integer("duration_ms"),
  error: text("error"),
  /** Scope trace of the message, without a foreign key: it outlives the project. */
  projectId: uuid("project_id"),
  status: varchar("status", { length: 16 }).$type<AiChatMessageStatus>().notNull().default("DONE"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_chat_msg_conv_created_idx").on(t.conversationId, t.createdAt),
  index("ai_chat_msg_running_idx").on(t.status).where(sql`${t.status} = 'RUNNING'`),
]);

export const aiChatToolCalls = pgTable("ai_chat_tool_calls", {
  id: uuid().primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => aiChatMessages.id, { onDelete: "cascade" }),
  tool: varchar("tool", { length: 100 }).notNull(),
  arguments: jsonb("arguments").notNull(),
  status: varchar("status", { length: 16 }).$type<AiChatToolCallStatus>().notNull().default("PROPOSED"),
  result: jsonb("result"),
  error: text("error"),
  approvedById: uuid("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_chat_tool_msg_idx").on(t.messageId),
]);

/** Monthly quota ledger: one row per reply whose cost is known. */
export const aiChatQuotaLedger = pgTable("ai_chat_quota_ledger", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  costUsd: decimal("cost_usd", { precision: 12, scale: 6 }).notNull(),
  model: varchar("model", { length: 200 }),
  /** No foreign key: the cost remains due even if the conversation is gone. */
  messageId: uuid("message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_chat_ledger_user_created_idx").on(t.userId, t.createdAt),
]);

/** Per-account quota exemption and reset (separate table so `users` stays untouched). */
export const aiChatQuotaOverrides = pgTable("ai_chat_quota_overrides", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  unlimited: boolean("unlimited").notNull().default(false),
  resetAt: timestamp("reset_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
