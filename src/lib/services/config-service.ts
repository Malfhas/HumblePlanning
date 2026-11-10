import { serverTimezone } from "@/lib/utils/dates";
import { themeColor } from "@/lib/utils/theme-color";
import { db } from "@/db";
import { appConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cached, invalidateCachePrefix } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { getEnvValue, isEnvManaged, isSecretKey, SECRET_KEYS } from "./config-secrets";
import { decryptSetting, encryptSetting, isEncryptedValue, loadConfigKeys, type ConfigEncryptionStatus } from "./config-crypto";
import { demoConfigOverride } from "@/lib/demo";

/**
 * Plain value of a stored setting. Secrets are encrypted at rest (config-crypto.ts):
 * an encrypted value is decrypted here, so every caller keeps receiving plain text.
 * A secret that cannot be decrypted (key lost or changed) reads as absent, as if
 * it had never been entered; `getUnreadableSecrets` lists it for the settings page.
 */
function readStored(key: string, stored: string | null): string | null {
  if (!stored || !isSecretKey(key) || !isEncryptedValue(stored)) return stored;
  const result = decryptSetting(key, stored, loadConfigKeys().readable);
  return result.ok ? result.value : null;
}

let warnedPlainSecret = false;

/** Value to store: a non-empty secret is encrypted when CONFIG_ENCRYPTION_KEY is set. */
function toStored(key: string, value: string): string {
  if (!value || !isSecretKey(key) || isEncryptedValue(value)) return value;
  const { current } = loadConfigKeys();
  if (current) return encryptSetting(key, value, current);
  if (!warnedPlainSecret) {
    warnedPlainSecret = true;
    logger.warn("system", "CONFIG_ENCRYPTION_KEY is missing or invalid: secret settings are stored in plain text in the database"); // i18n-ignore server log (internal)
  }
  return value;
}

/**
 * Returns the config stored in the DB (without .env override), secrets decrypted.
 * Used for the audit diff and as the source of truth for "value entered by the admin".
 */
export async function getAllConfig() {
  return cached("config:all", async () => {
    const rows = await db.select().from(appConfig).orderBy(appConfig.key);
    return rows.map((row) => ({ ...row, value: readStored(row.key, row.value) }));
  });
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
    return readStored(key, result?.value ?? null);
  });
}

/** Instance time zone: TIMEZONE setting, or with « auto » the server's (`serverTimezone`: TIMEZONE of .env, else Europe/Paris). */
export async function getInstanceTimezone(): Promise<string> {
  const { TIMEZONE } = await getConfigValues(["TIMEZONE"]);
  if (TIMEZONE && TIMEZONE !== "auto") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE });
      return TIMEZONE;
    } catch {
      /* unknown time zone: the server's */
    }
  }
  return serverTimezone();
}

/** Theme colour of the instance (THEME_COLOR, Settings → Appearance), "#rrggbb": the HumblePlanning violet by default. */
export async function getThemeColor(): Promise<string> {
  const { THEME_COLOR } = await getConfigValues(["THEME_COLOR"]);
  return themeColor(THEME_COLOR);
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
      map[key] = readStored(key, found?.value ?? null);
    }
    return map;
  });
}

/**
 * Returns the list of SECRET_KEYS that have a usable value in the DB
 * (excluding those overridden by .env, and those that cannot be decrypted).
 */
export async function getDbConfiguredSecrets(): Promise<string[]> {
  const rows = await db.select().from(appConfig);
  const configured: string[] = [];
  for (const row of rows) {
    if (!isSecretKey(row.key)) continue;
    if (isEnvManaged(row.key)) continue;
    const value = readStored(row.key, row.value);
    if (value && value.trim().length > 0) {
      configured.push(row.key);
    }
  }
  return configured;
}

/**
 * SECRET_KEYS stored encrypted with a key this instance does not have (lost or
 * changed CONFIG_ENCRYPTION_KEY, database restored from another instance), or
 * damaged. They read as absent until entered again; .env-managed keys excluded.
 */
export async function getUnreadableSecrets(): Promise<string[]> {
  const rows = await db.select().from(appConfig);
  const keys = loadConfigKeys().readable;
  return rows
    .filter((row) => isSecretKey(row.key) && !isEnvManaged(row.key) && isEncryptedValue(row.value))
    .filter((row) => !decryptSetting(row.key, row.value!, keys).ok)
    .map((row) => row.key);
}

/** State of the encryption at rest of the secret settings (CONFIG_ENCRYPTION_KEY). */
export function getConfigEncryptionStatus(): ConfigEncryptionStatus {
  return loadConfigKeys().status;
}

export { SECRET_KEYS };

function invalidateAllConfigCache() {
  invalidateCachePrefix("config:");
}

export async function setConfigValue(key: string, value: string, description?: string) {
  const existing = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, key),
  });

  const stored = toStored(key, value);
  let result;
  if (existing) {
    const [updated] = await db
      .update(appConfig)
      .set({ value: stored })
      .where(eq(appConfig.key, key))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(appConfig)
      .values({ key, value: stored, description })
      .returning();
    result = created;
  }

  invalidateAllConfigCache();
  return { ...result, value: readStored(key, result.value) };
}

export async function setConfigValues(values: Record<string, string>) {
  const results = [];
  for (const [key, value] of Object.entries(values)) {
    const existing = await db.query.appConfig.findFirst({
      where: eq(appConfig.key, key),
    });
    const stored = toStored(key, value);
    if (existing) {
      const [updated] = await db.update(appConfig).set({ value: stored }).where(eq(appConfig.key, key)).returning();
      results.push({ ...updated, value: readStored(key, updated.value) });
    } else {
      const [created] = await db.insert(appConfig).values({ key, value: stored }).returning();
      results.push({ ...created, value: readStored(key, created.value) });
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
