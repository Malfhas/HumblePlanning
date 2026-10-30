import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const fullKey = `hp_${raw}`;
  const prefix = `hp_${raw.slice(0, 8)}...`;
  const hash = hashKey(fullKey);
  return { fullKey, prefix, hash };
}

export async function createApiKey(name: string, userId: string): Promise<{ key: typeof apiKeys.$inferSelect; fullKey: string }> {
  const { fullKey, prefix, hash } = generateApiKey();

  const [created] = await db.insert(apiKeys).values({
    name,
    keyPrefix: prefix,
    keyHash: hash,
    userId,
  }).returning();

  return { key: created, fullKey };
}

export async function validateApiKey(key: string): Promise<{ userId: string; keyId: string; name: string } | null> {
  const hash = hashKey(key);
  const found = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, hash),
  });

  if (!found) return null;

  // Update lastUsedAt
  await db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, found.id));

  return { userId: found.userId, keyId: found.id, name: found.name };
}

export async function listApiKeys(userId?: string) {
  if (userId) {
    return db.query.apiKeys.findMany({
      where: eq(apiKeys.userId, userId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
  }
  return db.query.apiKeys.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

export async function deleteApiKey(id: string) {
  const [deleted] = await db.delete(apiKeys)
    .where(eq(apiKeys.id, id))
    .returning();
  return deleted;
}

export async function getApiKeyById(id: string) {
  return db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, id),
  });
}
