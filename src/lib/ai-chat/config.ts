import { z } from "zod";
import { getConfigValues, setConfigValues } from "@/lib/services/config-service";
import { isEnvManaged } from "@/lib/services/config-secrets";

/**
 * AI chat settings, stored in `app_config` under `AI_CHAT_*` keys (never
 * returned by `GET /api/config`, see `isPrivateConfigKey`). The OpenRouter
 * key is a secret: `.env` takes precedence, never returned to the front end.
 */

export type AiChatReasoning = "none" | "low" | "medium" | "high";

export const AI_CHAT_KEYS = {
  enabled: "AI_CHAT_ENABLED",
  apiKey: "OPENROUTER_API_KEY",
  models: "AI_CHAT_MODELS",
  defaultModel: "AI_CHAT_DEFAULT_MODEL",
  systemPrompt: "AI_CHAT_SYSTEM_PROMPT",
  dataCollection: "AI_CHAT_DATA_COLLECTION",
  zdr: "AI_CHAT_ZDR",
  nitro: "AI_CHAT_NITRO",
  maxTokens: "AI_CHAT_MAX_TOKENS",
  temperature: "AI_CHAT_TEMPERATURE",
  reasoning: "AI_CHAT_REASONING",
  maxDurationMinutes: "AI_CHAT_MAX_DURATION_MINUTES",
  maxConcurrentPerUser: "AI_CHAT_MAX_CONCURRENT_PER_USER",
  widgetEnabled: "AI_CHAT_WIDGET_ENABLED",
  widgetClosable: "AI_CHAT_WIDGET_CLOSABLE",
  dictationEnabled: "AI_CHAT_DICTATION_ENABLED",
  quotaEnabled: "AI_CHAT_QUOTA_ENABLED",
  quotaMonthlyUsd: "AI_CHAT_QUOTA_MONTHLY_USD",
  quotaResetDay: "AI_CHAT_QUOTA_RESET_DAY",
  quotaResetAt: "AI_CHAT_QUOTA_RESET_AT",
} as const;

/** Settings editable by the admin (the API key and the reset are handled separately). */
export const aiChatSettingsSchema = z.object({
  enabled: z.boolean(),
  models: z.array(z.string().trim().min(1).max(200)).max(100),
  defaultModel: z.string().trim().max(200),
  systemPrompt: z.string().max(50_000),
  dataCollection: z.enum(["deny", "allow"]),
  zdr: z.boolean(),
  nitro: z.boolean(),
  maxTokens: z.number().int().min(256).max(200_000),
  temperature: z.number().min(0).max(2),
  reasoning: z.enum(["none", "low", "medium", "high"]),
  maxDurationMinutes: z.number().int().min(1).max(30),
  maxConcurrentPerUser: z.number().int().min(1).max(20),
  widgetEnabled: z.boolean(),
  widgetClosable: z.boolean(),
  dictationEnabled: z.boolean(),
});
export type AiChatSettings = z.infer<typeof aiChatSettingsSchema>;

export const aiChatQuotaSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Per person and per month, in dollars; 0 = unlimited for everyone. */
  monthlyUsd: z.number().min(0).max(100_000),
  /** From the 1st to the 28th: so the day exists every month. */
  resetDay: z.number().int().min(1).max(28),
});
export type AiChatQuotaSettings = z.infer<typeof aiChatQuotaSettingsSchema> & {
  /** Global reset (ISO), which moves the start of the period forward. */
  resetAt: string | null;
};

export interface AiChatConfig extends AiChatSettings {
  /** Effective key (.env takes precedence), or null. */
  apiKey: string | null;
  quota: AiChatQuotaSettings;
}

export const AI_CHAT_DEFAULTS: AiChatSettings & { quota: AiChatQuotaSettings } = {
  enabled: false,
  // Empty by default: without a chosen model, the chat stays unavailable
  models: [],
  defaultModel: "",
  // Empty: the original (English) prompt applies
  systemPrompt: "",
  dataCollection: "deny",
  zdr: true,
  nitro: false,
  maxTokens: 8192,
  temperature: 0.3,
  reasoning: "medium",
  maxDurationMinutes: 5,
  maxConcurrentPerUser: 3,
  widgetEnabled: true,
  widgetClosable: true,
  dictationEnabled: true,
  quota: { enabled: true, monthlyUsd: 5, resetDay: 1, resetAt: null },
};

const bool = (value: string | null | undefined, fallback: boolean) =>
  value === "true" ? true : value === "false" ? false : fallback;

function bounded(value: string | null | undefined, fallback: number, min: number, max: number, integer = true) {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = integer ? Math.round(n) : n;
  return Math.min(max, Math.max(min, v));
}

function parseModels(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((m): m is string => typeof m === "string").map((m) => m.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Typed and bounded read, defaults included (same bounds as the source). */
export async function getAiChatConfig(): Promise<AiChatConfig> {
  const raw = await getConfigValues(Object.values(AI_CHAT_KEYS));
  const d = AI_CHAT_DEFAULTS;
  const reasoning = raw[AI_CHAT_KEYS.reasoning];
  const dataCollection = raw[AI_CHAT_KEYS.dataCollection];
  const resetAt = raw[AI_CHAT_KEYS.quotaResetAt];
  return {
    enabled: bool(raw[AI_CHAT_KEYS.enabled], d.enabled),
    apiKey: raw[AI_CHAT_KEYS.apiKey]?.trim() || null,
    models: parseModels(raw[AI_CHAT_KEYS.models]),
    defaultModel: raw[AI_CHAT_KEYS.defaultModel]?.trim() ?? d.defaultModel,
    systemPrompt: raw[AI_CHAT_KEYS.systemPrompt] ?? d.systemPrompt,
    dataCollection: dataCollection === "allow" ? "allow" : "deny",
    zdr: bool(raw[AI_CHAT_KEYS.zdr], d.zdr),
    nitro: bool(raw[AI_CHAT_KEYS.nitro], d.nitro),
    maxTokens: bounded(raw[AI_CHAT_KEYS.maxTokens], d.maxTokens, 256, 200_000),
    temperature: bounded(raw[AI_CHAT_KEYS.temperature], d.temperature, 0, 2, false),
    reasoning: reasoning === "none" || reasoning === "low" || reasoning === "medium" || reasoning === "high" ? reasoning : d.reasoning,
    maxDurationMinutes: bounded(raw[AI_CHAT_KEYS.maxDurationMinutes], d.maxDurationMinutes, 1, 30),
    maxConcurrentPerUser: bounded(raw[AI_CHAT_KEYS.maxConcurrentPerUser], d.maxConcurrentPerUser, 1, 20),
    widgetEnabled: bool(raw[AI_CHAT_KEYS.widgetEnabled], d.widgetEnabled),
    widgetClosable: bool(raw[AI_CHAT_KEYS.widgetClosable], d.widgetClosable),
    dictationEnabled: bool(raw[AI_CHAT_KEYS.dictationEnabled], d.dictationEnabled),
    quota: {
      enabled: bool(raw[AI_CHAT_KEYS.quotaEnabled], d.quota.enabled),
      monthlyUsd: bounded(raw[AI_CHAT_KEYS.quotaMonthlyUsd], d.quota.monthlyUsd, 0, 100_000, false),
      resetDay: bounded(raw[AI_CHAT_KEYS.quotaResetDay], d.quota.resetDay, 1, 28),
      resetAt: resetAt && !Number.isNaN(Date.parse(resetAt)) ? resetAt : null,
    },
  };
}

/** Effective default model: the configured one if it is in the list, otherwise the first. */
export function effectiveDefaultModel(config: Pick<AiChatConfig, "models" | "defaultModel">): string {
  if (config.defaultModel && config.models.includes(config.defaultModel)) return config.defaultModel;
  return config.models[0] ?? "";
}

/** Is the key provided by `.env` (read-only in the admin)? */
export function isApiKeyEnvManaged(): boolean {
  return isEnvManaged(AI_CHAT_KEYS.apiKey);
}

/** Saves the settings (and the key, if provided and not managed by `.env`). */
export async function saveAiChatSettings(settings: AiChatSettings, apiKey?: string | null) {
  const values: Record<string, string> = {
    [AI_CHAT_KEYS.enabled]: String(settings.enabled),
    [AI_CHAT_KEYS.models]: JSON.stringify([...new Set(settings.models.map((m) => m.trim()).filter(Boolean))]),
    [AI_CHAT_KEYS.defaultModel]: settings.defaultModel.trim(),
    [AI_CHAT_KEYS.systemPrompt]: settings.systemPrompt,
    [AI_CHAT_KEYS.dataCollection]: settings.dataCollection,
    [AI_CHAT_KEYS.zdr]: String(settings.zdr),
    [AI_CHAT_KEYS.nitro]: String(settings.nitro),
    [AI_CHAT_KEYS.maxTokens]: String(settings.maxTokens),
    [AI_CHAT_KEYS.temperature]: String(settings.temperature),
    [AI_CHAT_KEYS.reasoning]: settings.reasoning,
    [AI_CHAT_KEYS.maxDurationMinutes]: String(settings.maxDurationMinutes),
    [AI_CHAT_KEYS.maxConcurrentPerUser]: String(settings.maxConcurrentPerUser),
    [AI_CHAT_KEYS.widgetEnabled]: String(settings.widgetEnabled),
    [AI_CHAT_KEYS.widgetClosable]: String(settings.widgetClosable),
    [AI_CHAT_KEYS.dictationEnabled]: String(settings.dictationEnabled),
  };
  if (apiKey !== undefined && apiKey !== null && !isApiKeyEnvManaged()) {
    values[AI_CHAT_KEYS.apiKey] = apiKey.trim();
  }
  await setConfigValues(values);
}

export async function saveAiChatQuotaSettings(settings: z.infer<typeof aiChatQuotaSettingsSchema>) {
  await setConfigValues({
    [AI_CHAT_KEYS.quotaEnabled]: String(settings.enabled),
    [AI_CHAT_KEYS.quotaMonthlyUsd]: String(Math.round(settings.monthlyUsd * 100) / 100),
    [AI_CHAT_KEYS.quotaResetDay]: String(settings.resetDay),
  });
}

export async function resetAiChatQuotaForEveryone(at: Date) {
  await setConfigValues({ [AI_CHAT_KEYS.quotaResetAt]: at.toISOString() });
}
