import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

// MCP OAuth clients (registered dynamically by Claude, ChatGPT, etc.)
export const mcpClients = pgTable("mcp_clients", {
  id: uuid().primaryKey().defaultRandom(),
  clientId: varchar("client_id", { length: 100 }).notNull().unique(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientUri: text("client_uri"),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull().default([]),
  logoUri: text("logo_uri"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Temporary authorization codes (5 min, single use)
export const mcpAuthorizationCodes = pgTable("mcp_authorization_codes", {
  id: uuid().primaryKey().defaultRandom(),
  code: varchar("code", { length: 128 }).notNull().unique(),
  clientId: varchar("client_id", { length: 100 }).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: varchar("code_challenge_method", { length: 10 }).notNull().default("S256"),
  scope: text("scope").notNull().default("mcp"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Access + refresh tokens
export const mcpTokens = pgTable("mcp_tokens", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: varchar("client_id", { length: 100 }).notNull(),
  clientName: varchar("client_name", { length: 255 }),
  accessToken: varchar("access_token", { length: 128 }).notNull().unique(),
  refreshToken: varchar("refresh_token", { length: 128 }).unique(),
  scope: text("scope").notNull().default("mcp"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("mcp_tokens_user_id_idx").on(table.userId),
  index("mcp_tokens_access_token_idx").on(table.accessToken),
]);
