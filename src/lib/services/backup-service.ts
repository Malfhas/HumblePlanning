import { db } from "@/db";
import { backupHistory } from "@/db/schema";
import { eq, desc, lt, and, ne, sql, count } from "drizzle-orm";
import { getConfigValue } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { chmod } from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { parseDatabaseUrl, hasPgDumpLocal, getDockerContainer } from "@/lib/utils/database";

const execFileAsync = promisify(execFile);

const BACKUP_DIR = path.resolve(process.cwd(), "data/backups");
const BACKUP_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const ENCRYPTION_VERSION = 0x01;

// --- Encryption helpers ---

function getEncryptionKey(): Buffer {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) throw new AppError("settings.errors.backupKeyMissing");
  // Accept hex (64 chars) or base64 (44 chars) or raw
  if (/^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, "hex");
  const b64 = Buffer.from(key, "base64");
  if (b64.length === 32) return b64;
  // Hash arbitrary string to 32 bytes
  return crypto.createHash("sha256").update(key).digest();
}

function encryptFile(inputPath: string, outputPath: string): void {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const input = fs.readFileSync(inputPath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: [version 1B][IV 12B][encrypted data][authTag 16B]
  const output = Buffer.concat([
    Buffer.from([ENCRYPTION_VERSION]),
    iv,
    encrypted,
    authTag,
  ]);
  fs.writeFileSync(outputPath, output);
}

function decryptFile(inputPath: string): Buffer {
  const key = getEncryptionKey();
  const data = fs.readFileSync(inputPath);

  const version = data[0];
  if (version !== ENCRYPTION_VERSION) throw new AppError("settings.errors.backupUnsupportedEncryption", { params: { version } });

  const iv = data.subarray(1, 13);
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(13, data.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// --- pg_dump helper ---

async function runPgDump(outputPath: string): Promise<void> {
  const { host, port, user, password, database } = parseDatabaseUrl();

  if (await hasPgDumpLocal()) {
    const env = { ...process.env, PGPASSWORD: password };
    await execFileAsync("pg_dump", [
      "-h", host, "-p", port, "-U", user, "-d", database,
      "-Fc", "-f", outputPath,
    ], { env, timeout: BACKUP_TIMEOUT_MS });
  } else {
    const containerName = getDockerContainer();
    const tmpPath = "/tmp/humble_backup.dump";
    const env = { ...process.env };

    await execFileAsync("docker", [
      "exec", "-e", `PGPASSWORD=${password}`, containerName,
      "pg_dump", "-U", user, "-d", database, "-Fc", "-f", tmpPath,
    ], { env, timeout: BACKUP_TIMEOUT_MS });

    await execFileAsync("docker", [
      "cp", `${containerName}:${tmpPath}`, outputPath,
    ], { env, timeout: 60000 });

    execFileAsync("docker", ["exec", containerName, "rm", "-f", tmpPath]).catch(() => {});
  }
}

// --- Core functions ---

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

export async function createBackup(userId: string | null, triggerType: "manual" | "scheduled" = "manual") {
  ensureBackupDir();

  // Check no backup in progress
  const inProgress = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.status, "in_progress"),
  });
  if (inProgress) {
    throw new AppError("settings.errors.backupInProgress");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const filename = `backup_${timestamp}.enc`;
  const dumpPath = path.join(BACKUP_DIR, `temp_${timestamp}.dump`);
  const encPath = path.join(BACKUP_DIR, filename);

  // Create in_progress record
  const [record] = await db.insert(backupHistory).values({
    filename,
    sizeBytes: 0,
    durationMs: 0,
    status: "in_progress",
    triggerType,
    userId,
    encrypted: true,
  }).returning();

  const startTime = Date.now();

  try {
    // 1. pg_dump
    await runPgDump(dumpPath);

    const dumpStats = fs.statSync(dumpPath);
    const dumpSize = dumpStats.size;

    // 2. Encrypt
    encryptFile(dumpPath, encPath);

    // Restrict backup file permissions to owner-only (rw-------)
    await chmod(encPath, 0o600);

    const encStats = fs.statSync(encPath);
    const durationMs = Date.now() - startTime;

    // 3. Update record
    const [updated] = await db.update(backupHistory)
      .set({
        status: "completed",
        sizeBytes: dumpSize,
        sizeCompressed: encStats.size,
        durationMs,
      })
      .where(eq(backupHistory.id, record.id))
      .returning();

    // 4. Audit
    await logAudit({
      userId,
      action: "create",
      entityType: "backup",
      entityId: record.id,
      newValues: { filename, sizeBytes: dumpSize, triggerType },
    });

    // 5. Apply retention
    applyRetentionPolicy().catch(() => {});

    return updated;
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    await db.update(backupHistory)
      .set({
        status: "failed",
        // Error code (translated at display time) or technical pg_dump message.
        errorMessage: error.message?.slice(0, 1000) ?? "errors.unknown",
        durationMs,
      })
      .where(eq(backupHistory.id, record.id));
    throw error;
  } finally {
    // Cleanup temp file
    try { fs.unlinkSync(dumpPath); } catch {}
  }
}

export async function getBackupHistory(page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const [items, [{ total }]] = await Promise.all([
    db.query.backupHistory.findMany({
      orderBy: desc(backupHistory.createdAt),
      limit,
      offset,
      with: { user: { columns: { id: true, name: true, firstName: true } } },
    }),
    db.select({ total: count() }).from(backupHistory),
  ]);

  return { items, total, page, limit };
}

export async function getBackupById(id: string) {
  return db.query.backupHistory.findFirst({
    where: eq(backupHistory.id, id),
  });
}

export function getBackupStream(filename: string): Buffer {
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) throw new AppError("settings.errors.backupFileNotFound", { status: 404 });
  return decryptFile(filePath);
}

export async function deleteBackup(id: string, userId: string | null) {
  const record = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.id, id),
  });
  if (!record) throw new AppError("settings.errors.backupNotFound", { status: 404 });

  // Delete physical file
  const filePath = path.join(BACKUP_DIR, record.filename);
  try { fs.unlinkSync(filePath); } catch {}

  // Delete DB record
  await db.delete(backupHistory).where(eq(backupHistory.id, id));

  // Audit
  await logAudit({
    userId,
    action: "delete",
    entityType: "backup",
    entityId: id,
    oldValues: { filename: record.filename, sizeBytes: record.sizeBytes },
  });
}

// --- Retention policy ---

export async function applyRetentionPolicy() {
  const retentionDays = parseInt(await getConfigValue("BACKUP_RETENTION_DAYS") ?? "30", 10);
  const maxCount = parseInt(await getConfigValue("BACKUP_MAX_COUNT") ?? "10", 10);

  // 1. Delete expired backups
  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expired = await db.select({ id: backupHistory.id, filename: backupHistory.filename })
      .from(backupHistory)
      .where(and(
        lt(backupHistory.createdAt, cutoff),
        ne(backupHistory.status, "in_progress"),
      ));

    for (const record of expired) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, record.filename)); } catch {}
    }
    if (expired.length > 0) {
      await db.delete(backupHistory).where(
        sql`${backupHistory.id} IN (${sql.join(expired.map(e => sql`${e.id}`), sql`, `)})`
      );
    }
  }

  // 2. Enforce max count
  if (maxCount > 0) {
    const all = await db.select({ id: backupHistory.id, filename: backupHistory.filename })
      .from(backupHistory)
      .where(ne(backupHistory.status, "in_progress"))
      .orderBy(desc(backupHistory.createdAt));

    if (all.length > maxCount) {
      const toDelete = all.slice(maxCount);
      for (const record of toDelete) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, record.filename)); } catch {}
      }
      await db.delete(backupHistory).where(
        sql`${backupHistory.id} IN (${sql.join(toDelete.map(e => sql`${e.id}`), sql`, `)})`
      );
    }
  }
}

// --- Scheduler ---

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

function getNextRunTime(schedule: string, targetTime: string): number {
  const [hours, minutes] = targetTime.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);

  // If target time already passed today, schedule for next interval
  if (next.getTime() <= now.getTime()) {
    switch (schedule) {
      case "6h": next.setTime(next.getTime() + 6 * 60 * 60 * 1000); break;
      case "12h": next.setTime(next.getTime() + 12 * 60 * 60 * 1000); break;
      case "weekly": next.setDate(next.getDate() + 7); break;
      default: next.setDate(next.getDate() + 1); break; // daily
    }
  }

  return next.getTime() - now.getTime();
}

async function schedulerTick() {
  try {
    const enabled = await getConfigValue("BACKUP_ENABLED");
    if (enabled !== "true") return;

    await createBackup(null, "scheduled");
  } catch (error) {
    logger.error("backup", "Backup scheduler error", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    // Re-schedule next run
    scheduleNext();
  }
}

async function scheduleNext() {
  try {
    const enabled = await getConfigValue("BACKUP_ENABLED");
    if (enabled !== "true") {
      schedulerTimer = null;
      return;
    }

    const schedule = await getConfigValue("BACKUP_SCHEDULE") ?? "daily";
    const targetTime = await getConfigValue("BACKUP_TIME") ?? "02:00";
    const delay = getNextRunTime(schedule, targetTime);

    schedulerTimer = setTimeout(schedulerTick, delay);
  } catch {
    // Retry in 5 minutes on config read error
    schedulerTimer = setTimeout(scheduleNext, 5 * 60 * 1000);
  }
}

export function startBackupScheduler() {
  if (schedulerTimer) return;
  scheduleNext();
}

export function stopBackupScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

// --- Encryption key status ---

export function getEncryptionKeyStatus(): { configured: boolean } {
  return { configured: !!process.env.BACKUP_ENCRYPTION_KEY };
}
