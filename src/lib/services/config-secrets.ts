/**
 * Centralizes the list of configuration keys considered secrets.
 * These keys can be defined in `.env` (precedence) or in the `app_config` table.
 * Their value is NEVER returned to the front end.
 */
export const SECRET_KEYS = [
  "NUNTLY_API_KEY",
  "NUNTLY_WEBHOOK_SECRET",
  "SMTP_PASSWORD",
  "MAILGUN_API_KEY",
  // AI chat (OpenRouter). Recommended in `.env`: the database stores it in plain text.
  "OPENROUTER_API_KEY",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

const SECRET_KEYS_SET: ReadonlySet<string> = new Set(SECRET_KEYS);

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS_SET.has(key);
}

/**
 * Non-secret keys reserved for the admin: they never leave
 * `GET /api/config` (readable by any logged-in user). The AI chat settings
 * (system prompt, models, quotas) go through their admin routes.
 */
export function isPrivateConfigKey(key: string): boolean {
  return key.startsWith("AI_CHAT_") || key === UPDATE_CHECK_STATE_KEY;
}

/**
 * Reads the value of an environment variable, trims it, returns null if empty.
 */
export function getEnvValue(key: string): string | null {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A key is "env-managed" if it is in SECRET_KEYS
 * AND present (non-empty) in process.env. These keys cannot be edited
 * through the UI when defined in env — `.env` is authoritative.
 */
export function isEnvManaged(key: string): boolean {
  if (!SECRET_KEYS_SET.has(key)) return false;
  return getEnvValue(key) !== null;
}

/**
 * List of secret keys currently provided by .env (non-empty).
 */
export function getEnvManagedKeys(): string[] {
  return SECRET_KEYS.filter((k) => getEnvValue(k) !== null);
}

/**
 * Internal state of the update check (update-check-service.ts), stored in
 * `app_config`: private key (see isPrivateConfigKey), served to admins by
 * /api/system/version only.
 */
export const UPDATE_CHECK_STATE_KEY = "UPDATE_CHECK_STATE";
