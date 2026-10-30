import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { eq, and, isNull, gt, or } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { getConfigValue } from "./config-service";
import { users } from "@/db/schema";
import { AppError } from "@/lib/errors";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ─── Key Generation ───

export async function createMcpKey(
  name: string,
  userId: string
): Promise<{ key: typeof mcpTokens.$inferSelect; fullKey: string }> {
  // Check max keys per user
  const maxStr = await getConfigValue("MCP_MAX_KEYS_PER_USER");
  const max = parseInt(maxStr || "5", 10);
  // Only static keys count (clientId "key"): OAuth connections
  // (Claude, ChatGPT…) have their own tokens, which rotate on every refresh.
  const existing = await db.query.mcpTokens.findMany({
    where: and(eq(mcpTokens.userId, userId), eq(mcpTokens.clientId, "key"), isNull(mcpTokens.revokedAt)),
  });
  if (existing.length >= max) {
    throw new AppError("mcp.errors.keyLimitReached", { params: { max }, status: 403 });
  }

  const raw = randomBytes(32).toString("hex");
  const fullKey = `mcp_${raw}`;
  const prefix = `mcp_${raw.slice(0, 8)}...`;
  const hash = hashKey(fullKey);

  const [created] = await db.insert(mcpTokens).values({
    userId,
    clientId: "key",
    clientName: name,
    accessToken: hash,
    scope: "mcp",
    accessTokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
  }).returning();

  return { key: { ...created, accessToken: prefix }, fullKey };
}

// ─── Key Validation ───
// Validates either a static key (`mcp_…`) or an OAuth access token
// (`mcp_at_…`): both are stored hashed in `mcp_tokens.access_token`.

export async function validateMcpKey(
  key: string
): Promise<{ userId: string; keyId: string; name: string | null; locale: string | null } | null> {
  const hash = hashKey(key);
  const token = await db.query.mcpTokens.findFirst({
    where: and(
      eq(mcpTokens.accessToken, hash),
      isNull(mcpTokens.revokedAt),
      gt(mcpTokens.accessTokenExpiresAt, new Date())
    ),
  });

  if (!token) return null;

  // Check user is still active (and last known language: the user's MCP messages)
  const user = await db.query.users.findFirst({
    where: eq(users.id, token.userId),
    columns: { active: true, locale: true },
  });
  if (!user || user.active === false) return null;

  // Update lastUsedAt
  await db.update(mcpTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpTokens.id, token.id));

  return { userId: token.userId, keyId: token.id, name: token.clientName, locale: user.locale ?? null };
}

// ─── Key Management ───

/** "Key or connection still usable" condition (valid access or valid refresh). */
export function activeMcpTokenCondition() {
  const now = new Date();
  return and(
    isNull(mcpTokens.revokedAt),
    or(gt(mcpTokens.accessTokenExpiresAt, now), gt(mcpTokens.refreshTokenExpiresAt, now)),
  );
}

export async function listMcpKeys(userId: string) {
  const keys = await db.query.mcpTokens.findMany({
    where: and(eq(mcpTokens.userId, userId), activeMcpTokenCondition()),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  // Mask the hash, show only prefix stored in accessToken
  return keys.map((k) => ({
    id: k.id,
    name: k.clientName,
    // "key" = static key created in the profile; "oauth" = connection authorized
    // from an assistant (Claude, ChatGPT…), revocable the same way.
    type: k.clientId === "key" ? "key" as const : "oauth" as const,
    keyPrefix: k.accessToken.startsWith("mcp_") ? k.accessToken : "mcp_****...",
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));
}

export async function revokeMcpKey(userId: string, keyId: string) {
  await db.update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(mcpTokens.id, keyId),
      eq(mcpTokens.userId, userId),
      isNull(mcpTokens.revokedAt)
    ));
}
