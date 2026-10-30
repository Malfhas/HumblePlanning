import nodemailer from "nodemailer";
import Nuntly from "@nuntly/sdk";
import { getConfigValues } from "./config-service";
import { logger } from "@/lib/logger";
import { db } from "@/db";
import { emailLogs } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isDemoMode } from "@/lib/demo";
import { dateSettingsFromConfig } from "@/lib/utils/dates";
import { resolveRequestLocale } from "@/i18n/resolve-locale";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

interface EmailConfig {
  provider: "smtp" | "mailgun" | "nuntly";
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
  smtpLogin: string;
  smtpPassword: string;
  smtpSecure: string;
  mailgunApiKey: string;
  mailgunDomain: string;
  mailgunRegion: string;
  nuntlyApiKey: string;
}

/**
 * Returns the list of missing credentials for the active provider.
 * An empty array means the config is complete.
 */
function getMissingCredentials(config: EmailConfig): string[] {
  const missing: string[] = [];
  if (config.provider === "nuntly") {
    if (!config.nuntlyApiKey.trim()) missing.push("NUNTLY_API_KEY");
  } else if (config.provider === "mailgun") {
    if (!config.mailgunApiKey.trim()) missing.push("MAILGUN_API_KEY");
    if (!config.mailgunDomain.trim()) missing.push("MAILGUN_DOMAIN");
  } else if (config.provider === "smtp") {
    if (!config.smtpHost.trim()) missing.push("SMTP_HOST");
    if (!config.smtpLogin.trim()) missing.push("SMTP_LOGIN");
    if (!config.smtpPassword.trim()) missing.push("SMTP_PASSWORD");
  }
  return missing;
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const values = await getConfigValues([
    "EMAIL_PROVIDER",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_FROM",
    "SMTP_LOGIN",
    "SMTP_PASSWORD",
    "SMTP_SECURE",
    "MAILGUN_API_KEY",
    "MAILGUN_DOMAIN",
    "MAILGUN_REGION",
    "NUNTLY_API_KEY",
  ]);

  return {
    provider: (values.EMAIL_PROVIDER as "smtp" | "mailgun" | "nuntly") || "nuntly",
    smtpHost: values.SMTP_HOST || "",
    smtpPort: parseInt(values.SMTP_PORT || "587", 10),
    smtpFrom: values.SMTP_FROM || "noreply@humbleplanning.local",
    smtpLogin: values.SMTP_LOGIN || "",
    smtpPassword: values.SMTP_PASSWORD || "",
    smtpSecure: values.SMTP_SECURE || "tls",
    mailgunApiKey: values.MAILGUN_API_KEY || "",
    mailgunDomain: values.MAILGUN_DOMAIN || "",
    mailgunRegion: values.MAILGUN_REGION || "eu",
    nuntlyApiKey: values.NUNTLY_API_KEY || "",
  };
}

async function sendViaSMTP(payload: EmailPayload, config: EmailConfig) {
  if (config.smtpSecure === "none") {
    logger.warn("email", "SMTP secure mode is 'none' — TLS certificate validation disabled. Not recommended for production.");
  }
  const secure = config.smtpSecure === "ssl";
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure,
    ...(config.smtpSecure === "none" ? { tls: { rejectUnauthorized: false } } : {}),
    auth: config.smtpLogin
      ? { user: config.smtpLogin, pass: config.smtpPassword }
      : undefined,
  });

  await transporter.sendMail({
    from: config.smtpFrom,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
}

async function sendViaMailgun(payload: EmailPayload, config: EmailConfig) {
  const baseUrl =
    config.mailgunRegion === "eu"
      ? "https://api.eu.mailgun.net"
      : "https://api.mailgun.net";

  const formData = new FormData();
  formData.append("from", config.smtpFrom);
  formData.append("to", payload.to);
  formData.append("subject", payload.subject);
  formData.append("html", payload.html);

  const response = await fetch(
    `${baseUrl}/v3/${config.mailgunDomain}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${config.mailgunApiKey}`)}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mailgun error ${response.status}: ${text}`);
  }
}

async function sendViaNuntly(payload: EmailPayload, config: EmailConfig) {
  // Timeout 90s (default SDK = 60s — too short if Nuntly takes time to
  // respond, e.g. cold start, Cloudflare latency). maxRetries 0 to avoid
  // duplicates: the SDK does not send an idempotency key by default, so
  // a retry after a client-side timeout can send the same email several
  // times if Nuntly had already accepted the first request.
  const client = new Nuntly({
    apiKey: config.nuntlyApiKey,
    timeout: 90_000,
    maxRetries: 0,
  });
  const result = await client.emails.send({
    from: config.smtpFrom,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
  if (!result?.id) {
    throw new Error("Nuntly: no message ID returned"); // technical provider error (email_logs log)
  }
}

// Throttle: serialize email sends with configurable delay between each
let lastSendTime = 0;
let sendQueue: Promise<void> = Promise.resolve();

export async function sendEmail(payload: EmailPayload) {
  // Demo instance: no e-mail ever leaves the server
  if (isDemoMode()) {
    logger.info("email", "Demo mode: e-mail not sent", { to: payload.to });
    return;
  }
  // Chain onto the queue to serialize sends
  sendQueue = sendQueue.then(async () => {
    // Check Nuntly blocklist (only enforced when EMAIL_PROVIDER === "nuntly")
    const { isEmailBlocked } = await import("./email-blocklist-service");
    if (await isEmailBlocked(payload.to)) {
      logEmailSend(payload, "blocked", "error", "Email bloqué (blocklist Nuntly)").catch(() => {}); // i18n-ignore journal interne (email_logs)
      throw new AppError("notifications.errors.email.blocked");
    }

    const config = await getEmailConfig();

    // Validate provider credentials (env or DB) — disable sending if missing.
    const missingCredentials = getMissingCredentials(config);
    if (missingCredentials.length > 0) {
      const keys = missingCredentials.join(", ");
      // i18n-ignore internal log (email_logs); the thrown error is translated into the request language
      const logMessage = `Envoi email désactivé : credentials manquantes pour le provider "${config.provider}" (${keys}). Renseignez-les dans Paramètres > Email ou dans le fichier .env.`;
      logEmailSend(payload, config.provider, "error", logMessage).catch(() => {});
      throw new AppError("notifications.errors.email.disabled", { params: { provider: config.provider, keys } });
    }

    const throttleConfig = await getConfigValues(["EMAIL_THROTTLE_DELAY"]);
    const throttleDelay = parseInt(throttleConfig.EMAIL_THROTTLE_DELAY || "0", 10) * 1000;

    if (throttleDelay > 0) {
      const elapsed = Date.now() - lastSendTime;
      if (elapsed < throttleDelay) {
        await new Promise((r) => setTimeout(r, throttleDelay - elapsed));
      }
    }

    try {
      if (config.provider === "nuntly") {
        await sendViaNuntly(payload, config);
      } else if (config.provider === "mailgun") {
        await sendViaMailgun(payload, config);
      } else {
        await sendViaSMTP(payload, config);
      }
      lastSendTime = Date.now();
      logEmailSend(payload, config.provider, "success").catch(() => {});
    } catch (err) {
      logEmailSend(payload, config.provider, "error", err instanceof Error ? err.message : String(err)).catch(() => {});
      throw err;
    }
  }).catch((err) => {
    logger.error("email", "Email send error", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  });

  return sendQueue;
}

async function logEmailSend(
  payload: EmailPayload,
  provider: string,
  status: "success" | "error",
  error?: string,
) {
  await db.insert(emailLogs).values({
    recipient: payload.to,
    subject: payload.subject?.slice(0, 500),
    status,
    error: error ?? null,
    provider,
  });
}

export async function testEmailConnection(to?: string) {
  const config = await getEmailConfig();
  const recipient = to || config.smtpFrom;

  const { getConfigValues } = await import("./config-service");
  const appConfig = await getConfigValues(["APP_TITLE", "PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE"]);
  const { testEmailTemplate } = await import("./email-templates");
  // Test started from Settings: request language (the admin's).
  const { subject, html } = testEmailTemplate(appConfig.APP_TITLE || "HumblePlanning", await resolveRequestLocale(), {
    dates: dateSettingsFromConfig(appConfig),
  });
  const payload: EmailPayload = { to: recipient, subject, html };

  try {
    if (config.provider === "nuntly") {
      await sendViaNuntly(payload, config);
    } else if (config.provider === "mailgun") {
      await sendViaMailgun(payload, config);
    } else {
      if (config.smtpSecure === "none") {
        logger.warn("email", "SMTP secure mode is 'none' — TLS certificate validation disabled. Not recommended for production.");
      }
      const secure = config.smtpSecure === "ssl";
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure,
        ...(config.smtpSecure === "none" ? { tls: { rejectUnauthorized: false } } : {}),
        auth: config.smtpLogin
          ? { user: config.smtpLogin, pass: config.smtpPassword }
          : undefined,
      });

      await transporter.verify();
      await transporter.sendMail({
        from: config.smtpFrom,
        to: recipient,
        subject,
        html,
      });
    }
    logEmailSend(payload, config.provider, "success").catch(() => {});
  } catch (err) {
    logEmailSend(payload, config.provider, "error", err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}
