import { db } from "@/db";
import { appConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cached, invalidateCachePrefix } from "@/lib/cache";
import { getEnvValue, isEnvManaged, isSecretKey, SECRET_KEYS } from "./config-secrets";
import { demoConfigOverride } from "@/lib/demo";

/**
 * Returns the raw config stored in the DB (without .env override).
 * Used for the audit diff and as the source of truth for "value entered by the admin".
 */
export async function getAllConfig() {
  return cached("config:all", () =>
    db.select().from(appConfig).orderBy(appConfig.key)
  );
}

/**
 * Returns the effective value of a key:
 * - Demo instance: some settings are forced (see `demoConfigOverride`)
 * - If the key is a SECRET_KEY and present in process.env → returns the .env value
 * - Otherwise → returns the DB value (or null)
 */
export async function getConfigValue(key: string): Promise<string | null> {
  const forced = demoConfigOverride(key);
  if (forced !== undefined) return forced;
  if (isEnvManaged(key)) {
    return getEnvValue(key);
  }
  return cached(`config:${key}`, async () => {
    const result = await db.query.appConfig.findFirst({
      where: eq(appConfig.key, key),
    });
    return result?.value ?? null;
  });
}

/** Instance time zone: TIMEZONE setting (« auto » = the server's), otherwise Europe/Paris. */
export async function getInstanceTimezone(): Promise<string> {
  const { TIMEZONE } = await getConfigValues(["TIMEZONE"]);
  const candidates = [TIMEZONE, process.env.TIMEZONE, "Europe/Paris"];
  for (const tz of candidates) {
    if (!tz || tz === "auto") continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      /* unknown time zone: next */
    }
  }
  return "Europe/Paris";
}

export async function getConfigValues(keys: string[]): Promise<Record<string, string | null>> {
  return cached(`config:multi:${keys.sort().join(",")}`, async () => {
    const results = await db.select().from(appConfig);
    const map: Record<string, string | null> = {};
    for (const key of keys) {
      const forced = demoConfigOverride(key);
      if (forced !== undefined) {
        map[key] = forced;
        continue;
      }
      if (isEnvManaged(key)) {
        map[key] = getEnvValue(key);
        continue;
      }
      const found = results.find((r) => r.key === key);
      map[key] = found?.value ?? null;
    }
    return map;
  });
}

/**
 * Returns the list of SECRET_KEYS that have a non-empty value in the DB
 * (excluding those overridden by .env).
 */
export async function getDbConfiguredSecrets(): Promise<string[]> {
  const rows = await db.select().from(appConfig);
  const configured: string[] = [];
  for (const row of rows) {
    if (!isSecretKey(row.key)) continue;
    if (isEnvManaged(row.key)) continue;
    if (row.value && row.value.trim().length > 0) {
      configured.push(row.key);
    }
  }
  return configured;
}

export { SECRET_KEYS };

function invalidateAllConfigCache() {
  invalidateCachePrefix("config:");
}

export async function setConfigValue(key: string, value: string, description?: string) {
  const existing = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, key),
  });

  let result;
  if (existing) {
    const [updated] = await db
      .update(appConfig)
      .set({ value })
      .where(eq(appConfig.key, key))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(appConfig)
      .values({ key, value, description })
      .returning();
    result = created;
  }

  invalidateAllConfigCache();
  return result;
}

export async function setConfigValues(values: Record<string, string>) {
  const results = [];
  for (const [key, value] of Object.entries(values)) {
    const existing = await db.query.appConfig.findFirst({
      where: eq(appConfig.key, key),
    });
    if (existing) {
      const [updated] = await db.update(appConfig).set({ value }).where(eq(appConfig.key, key)).returning();
      results.push(updated);
    } else {
      const [created] = await db.insert(appConfig).values({ key, value }).returning();
      results.push(created);
    }
  }
  invalidateAllConfigCache();
  return results;
}

export async function deleteConfigValue(key: string) {
  const [deleted] = await db
    .delete(appConfig)
    .where(eq(appConfig.key, key))
    .returning();
  invalidateAllConfigCache();
  return deleted;
}
