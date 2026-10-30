import { db } from "@/db";
import { smsLogs } from "@/db/schema";
import { getConfigValues } from "./config-service";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { isDemoMode } from "@/lib/demo";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

/**
 * Feature flag: SMS / WhatsApp via Sent.dm.
 * Set to `false` to hard-disable the feature at runtime regardless of
 * the DB config values (NOTIFICATION_SMS_ENABLED, SENT_API_KEY, etc.).
 *
 * When `false`:
 * - sendSentMessage() is a no-op (no API call, no log write)
 * - testSentConnection() throws
 * - isSentConfigured() returns false
 * - getEligibleSmsRecipients() (notification-queue) short-circuits to []
 *
 * Flip to `true` and restore the UI (settings page + user form) to re-enable.
 */
export const SMS_FEATURE_ENABLED = false;

async function logSmsSend(recipient: string, status: "success" | "error", error?: string) {
  try {
    await db.insert(smsLogs).values({
      recipient: recipient.slice(0, 30),
      status,
      error: error ? error.slice(0, 500) : null,
      provider: "sent.dm",
    });
  } catch (err) {
    logger.error("sms", "Failed to log SMS send", { error: err instanceof Error ? err.message : String(err) });
  }
}

export interface SentMessagePayload {
  phoneNumber: string;
  templateVariables?: Record<string, string>;
}

interface SentConfig {
  apiKey: string;
  senderId: string;
  templateId: string;
}

const SENT_API_URL = "https://api.sent.dm/v2/messages/phone";

async function getSentConfig(): Promise<SentConfig | null> {
  const config = await getConfigValues(["SENT_API_KEY", "SENT_SENDER_ID", "SENT_TEMPLATE_ID"]);
  if (!config.SENT_API_KEY || !config.SENT_SENDER_ID || !config.SENT_TEMPLATE_ID) {
    return null;
  }
  return {
    apiKey: config.SENT_API_KEY,
    senderId: config.SENT_SENDER_ID,
    templateId: config.SENT_TEMPLATE_ID,
  };
}

async function sendViaSentApi(payload: SentMessagePayload, config: SentConfig) {
  const body = {
    phoneNumber: payload.phoneNumber,
    templateId: config.templateId,
    templateVariables: payload.templateVariables ?? {},
  };

  const response = await fetch(SENT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "x-sender-id": config.senderId,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Sent.dm API error ${response.status}: ${text || response.statusText}`);
  }
}

// Throttle: serialize sends with configurable delay
let lastSendTime = 0;
let sendQueue: Promise<void> = Promise.resolve();

export async function sendSentMessage(payload: SentMessagePayload): Promise<void> {
  if (isDemoMode()) {
    logger.info("sms", "Demo mode: SMS not sent", { to: payload.phoneNumber });
    return;
  }
  if (!SMS_FEATURE_ENABLED) {
    logger.warn("sms", "SMS feature is disabled — skipping message", { to: payload.phoneNumber });
    return;
  }
  sendQueue = sendQueue.then(async () => {
    const config = await getSentConfig();
    if (!config) {
      logger.warn("sms", "Sent.dm not configured, skipping message", { to: payload.phoneNumber });
      return;
    }

    const throttleConfig = await getConfigValues(["SMS_THROTTLE_DELAY"]);
    const throttleDelay = parseInt(throttleConfig.SMS_THROTTLE_DELAY || "0", 10) * 1000;
    if (throttleDelay > 0) {
      const elapsed = Date.now() - lastSendTime;
      if (elapsed < throttleDelay) {
        await new Promise((r) => setTimeout(r, throttleDelay - elapsed));
      }
    }

    try {
      await sendViaSentApi(payload, config);
      lastSendTime = Date.now();
      logger.info("sms", "SMS sent via Sent.dm", { to: payload.phoneNumber });
      logSmsSend(payload.phoneNumber, "success").catch(() => {});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("sms", "Failed to send SMS via Sent.dm", { to: payload.phoneNumber, error: errMsg });
      logSmsSend(payload.phoneNumber, "error", errMsg).catch(() => {});
      throw err;
    }
  }).catch((err) => {
    logger.error("sms", "SMS send queue error", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  });

  return sendQueue;
}

export async function testSentConnection(phoneNumber: string): Promise<void> {
  if (!SMS_FEATURE_ENABLED) {
    throw new AppError("notifications.errors.sms.disabled");
  }
  const config = await getSentConfig();
  if (!config) {
    throw new AppError("notifications.errors.sms.notConfigured");
  }

  const appConfig = await getConfigValues(["APP_TITLE", "APP_BASE_URL"]);
  const appTitle = appConfig.APP_TITLE || "HumblePlanning";
  const appUrl = appConfig.APP_BASE_URL || "";
  // Test started from Settings: request language (the admin's).
  const t = await getServerTranslator(await resolveRequestLocale());

  try {
    await sendViaSentApi(
      {
        phoneNumber,
        templateVariables: {
          "1": appTitle,
          "2": t("notifications.sms.test.event"),
          "3": t("notifications.sms.test.project"),
          "4": t("notifications.sms.test.message"),
          "5": appUrl,
        },
      },
      config,
    );
    logSmsSend(phoneNumber, "success").catch(() => {});
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logSmsSend(phoneNumber, "error", errMsg).catch(() => {});
    throw err;
  }
}

export async function isSentConfigured(): Promise<boolean> {
  if (!SMS_FEATURE_ENABLED) return false;
  const config = await getSentConfig();
  return config !== null;
}
