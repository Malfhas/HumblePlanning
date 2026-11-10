/**
 * System health page: live state of the services, configuration alerts,
 * background tasks and failed deliveries. Grouped incidents are in
 * system-event-service.ts.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { backupHistory, emailLogs, smsLogs, webhookLogs } from "@/db/schema";
import { isAltchaConfigured } from "@/lib/altcha";
import { getConfigEncryptionStatus, getConfigValues, getInstanceTimezone } from "./config-service";
import { getEmailConfig } from "./email-service";
import { readServiceAccount } from "./fcm-service";
import { fetchSocketHealth } from "./socket-health";
import { getLastTaskRuns } from "./system-task-service";
import { getVersionStatus } from "./update-check-service";
import { isDemoMode } from "@/lib/demo";
import { SYSTEM_TASKS, type SystemTask } from "@/lib/system-health/categories";
import { getNextRun } from "@/lib/system-health/next-runs";

/** Configuration problems detected (labels: `admin.systemHealth.alerts.<id>`). */
export type ConfigAlert = "configEncryptionKey" | "smtpWithoutTls" | "temporaryAuthSecret" | "captchaNotConfigured" | "fcmInvalid";

async function checkDatabase() {
  const start = performance.now();
  try {
    await db.execute(sql`select 1`);
    return { ok: true as const, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRealtime() {
  const health = await fetchSocketHealth();
  return health.ok
    ? { ok: true as const, clients: health.data.clients ?? null, uptimeSeconds: health.data.uptime ?? null }
    : { ok: false as const, error: health.error };
}

async function checkVersion() {
  const status = await getVersionStatus();
  return {
    currentVersion: status.currentVersion,
    status: status.status,
    latestVersion: status.latest?.version ?? null,
    updateAvailable: status.updateAvailable,
    securityUpdate: status.securityUpdate,
    checkedAt: status.checkedAt,
  };
}

async function lastBackup() {
  const [last] = await db
    .select({
      createdAt: backupHistory.createdAt,
      status: backupHistory.status,
      triggerType: backupHistory.triggerType,
      sizeBytes: backupHistory.sizeBytes,
      errorMessage: backupHistory.errorMessage,
    })
    .from(backupHistory)
    .orderBy(desc(backupHistory.createdAt))
    .limit(1);
  return last ?? null;
}

export async function getConfigAlerts(): Promise<ConfigAlert[]> {
  const [config, email] = await Promise.all([
    getConfigValues(["CAPTCHA_ENABLED", "CAPTCHA_PROVIDER", "CAPTCHA_SITE_KEY", "CAPTCHA_SECRET_KEY", "FCM_SERVICE_ACCOUNT_JSON"]),
    getEmailConfig(),
  ]);
  const alerts: ConfigAlert[] = [];
  if (getConfigEncryptionStatus() !== "active") alerts.push("configEncryptionKey");
  if (email.provider === "smtp" && email.smtpSecure === "none") alerts.push("smtpWithoutTls");
  if (!process.env.BETTER_AUTH_SECRET) alerts.push("temporaryAuthSecret");
  if (config.CAPTCHA_ENABLED === "true") {
    const provider = config.CAPTCHA_PROVIDER || "altcha";
    const configured = provider === "altcha" ? isAltchaConfigured() : Boolean(config.CAPTCHA_SITE_KEY && config.CAPTCHA_SECRET_KEY);
    if (!configured) alerts.push("captchaNotConfigured");
  }
  if (config.FCM_SERVICE_ACCOUNT_JSON && !readServiceAccount(config.FCM_SERVICE_ACCOUNT_JSON)) alerts.push("fcmInvalid");
  return alerts;
}

/** Last run of each background task, whether it is on, and its next run when the scheduler published it. */
async function getTasks() {
  const [runs, config] = await Promise.all([
    getLastTaskRuns(),
    getConfigValues(["BACKUP_ENABLED", "WEEKLY_SUMMARY_ENABLED", "UPDATE_CHECK_ENABLED"]),
  ]);
  const enabled: Record<SystemTask, boolean> = {
    daily_purge: true,
    backup: config.BACKUP_ENABLED === "true",
    weekly_summary: config.WEEKLY_SUMMARY_ENABLED === "true",
    update_check: !isDemoMode() && config.UPDATE_CHECK_ENABLED !== "false",
  };
  return SYSTEM_TASKS.map((task) => {
    const run = runs.get(task);
    return {
      task,
      enabled: enabled[task],
      nextRunAt: enabled[task] ? getNextRun(task)?.toISOString() ?? null : null,
      lastRun: run
        ? { startedAt: run.startedAt, finishedAt: run.finishedAt, success: run.success, detail: run.detail as Record<string, unknown> | null }
        : null,
    };
  });
}

export async function getSystemOverview() {
  const [database, realtime, version, backup, alerts, tasks, timeZone] = await Promise.all([
    checkDatabase(),
    checkRealtime(),
    checkVersion(),
    lastBackup(),
    getConfigAlerts(),
    getTasks(),
    getInstanceTimezone(),
  ]);
  // The clock of the server, read last (the closest to the answer), and the zone in which it writes the times
  const clock = { now: new Date().toISOString(), timeZone };
  return { database, realtime, version, backup, alerts, tasks, clock };
}

/** E-mails, SMS and webhooks in failure over the period, most recent first. */
export async function getFailedDeliveries(since: Date | null, limit = 50) {
  const [emails, sms, webhooks] = await Promise.all([
    db
      .select({ id: emailLogs.id, at: emailLogs.sentAt, recipient: emailLogs.recipient, subject: emailLogs.subject, error: emailLogs.error, provider: emailLogs.provider })
      .from(emailLogs)
      .where(and(eq(emailLogs.status, "error"), since ? gte(emailLogs.sentAt, since) : undefined))
      .orderBy(desc(emailLogs.sentAt))
      .limit(limit),
    db
      .select({ id: smsLogs.id, at: smsLogs.sentAt, recipient: smsLogs.recipient, error: smsLogs.error, provider: smsLogs.provider })
      .from(smsLogs)
      .where(and(eq(smsLogs.status, "error"), since ? gte(smsLogs.sentAt, since) : undefined))
      .orderBy(desc(smsLogs.sentAt))
      .limit(limit),
    db
      .select({ id: webhookLogs.id, at: webhookLogs.receivedAt, provider: webhookLogs.provider, eventType: webhookLogs.eventType, status: webhookLogs.status, error: webhookLogs.errorMessage })
      .from(webhookLogs)
      .where(and(inArray(webhookLogs.status, ["error", "invalid_signature"]), since ? gte(webhookLogs.receivedAt, since) : undefined))
      .orderBy(desc(webhookLogs.receivedAt))
      .limit(limit),
  ]);
  return { emails, sms, webhooks };
}
