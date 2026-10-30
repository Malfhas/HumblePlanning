import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import postgres from "postgres";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import {
  parseDatabaseUrl,
  buildConnectionUrl,
  buildMaintenanceUrl,
  hasPgRestoreLocal,
  getDockerContainer,
} from "@/lib/utils/database";

const execFileAsync = promisify(execFile);

const TEMP_DB_NAME = "humble_planning_import_temp";
const IMPORT_DIR = path.resolve(process.cwd(), "data/imports");
const IMPORT_DUMP_FILE = "pending_import.dump";
const RESTORE_TIMEOUT_MS = 30 * 60 * 1000;

// --- Tables to analyze (business data only, not system tables) ---
// Labels translated at render time: settings.panels.import.tables.<table>.

const ANALYZABLE_TABLES = [
  "users",
  "teams",
  "roles",
  "role_permissions",
  "projects",
  "project_groups",
  "tasks",
  "task_users",
  "statuses",
  "places",
  "qualifications",
  "holidays",
  "vehicles",
  "vehicle_types",
  "vehicle_assignments",
  "resources",
  "resource_types",
  "resource_assignments",
  "business_units",
  "labor_types",
] as const;

// Order for merge import — parents before children (FK dependencies)
const MERGE_IMPORT_ORDER = [
  "business_units", "labor_types",
  "teams", "roles", "role_permissions",
  "vehicle_types", "resource_types",
  "statuses", "places", "qualifications",
  "users", "user_qualifications",
  "project_groups", "projects", "project_labor_budgets",
  "vehicles", "resources",
  "tasks", "task_users",
  "vehicle_assignments", "resource_assignments",
  "holidays",
];

// --- Types ---

export interface TableAnalysis {
  table: string;
  countInDump: number;
  countInLive: number;
  conflictCount: number;
}

export interface ImportAnalysis {
  tables: TableAnalysis[];
  totalInDump: number;
  totalConflicts: number;
  valid: boolean;
}

export interface ImportResult {
  success: boolean;
  mode: "merge" | "replace";
  inserted?: Record<string, number>;
  forceReload?: boolean;
}

// --- Helpers ---

function ensureImportDir() {
  if (!fs.existsSync(IMPORT_DIR)) {
    fs.mkdirSync(IMPORT_DIR, { recursive: true });
  }
}

export function getImportDumpPath(): string {
  return getDumpPath();
}

function getDumpPath(): string {
  return path.join(IMPORT_DIR, IMPORT_DUMP_FILE);
}

/** Validate that the file starts with PGDMP magic bytes */
export function validateDumpFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return buf.toString("ascii") === "PGDMP";
  } catch {
    return false;
  }
}

// --- Temp database management ---

async function createTempDatabase(): Promise<void> {
  const maintenanceUrl = buildMaintenanceUrl();
  const sql = postgres(maintenanceUrl, { max: 1 });
  try {
    // Terminate any existing connections to temp DB
    await sql.unsafe(`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${TEMP_DB_NAME}' AND pid <> pg_backend_pid()
    `).catch(() => {});
    await sql.unsafe(`DROP DATABASE IF EXISTS ${TEMP_DB_NAME}`);
    await sql.unsafe(`CREATE DATABASE ${TEMP_DB_NAME}`);
    logger.info("import", `Temporary database ${TEMP_DB_NAME} created`);
  } finally {
    await sql.end();
  }
}

async function dropTempDatabase(): Promise<void> {
  const maintenanceUrl = buildMaintenanceUrl();
  const sql = postgres(maintenanceUrl, { max: 1 });
  try {
    await sql.unsafe(`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${TEMP_DB_NAME}' AND pid <> pg_backend_pid()
    `).catch(() => {});
    await sql.unsafe(`DROP DATABASE IF EXISTS ${TEMP_DB_NAME}`);
    logger.info("import", `Temporary database ${TEMP_DB_NAME} dropped`);
  } finally {
    await sql.end();
  }
}

// --- pg_restore ---

async function restoreToTempDb(dumpPath: string): Promise<void> {
  const { host, port, user, password } = parseDatabaseUrl();

  if (await hasPgRestoreLocal()) {
    const env = { ...process.env, PGPASSWORD: password };
    await execFileAsync("pg_restore", [
      "-h", host, "-p", port, "-U", user,
      "-d", TEMP_DB_NAME,
      "--no-owner", "--no-privileges",
      dumpPath,
    ], { env, timeout: RESTORE_TIMEOUT_MS });
  } else {
    const containerName = getDockerContainer();
    const tmpPath = "/tmp/humble_import.dump";

    await execFileAsync("docker", [
      "cp", dumpPath, `${containerName}:${tmpPath}`,
    ], { timeout: 60000 });

    await execFileAsync("docker", [
      "exec", "-e", `PGPASSWORD=${password}`, containerName,
      "pg_restore", "-U", user, "-d", TEMP_DB_NAME,
      "--no-owner", "--no-privileges", tmpPath,
    ], { timeout: RESTORE_TIMEOUT_MS });

    execFileAsync("docker", ["exec", containerName, "rm", "-f", tmpPath]).catch(() => {});
  }
}

/**
 * Wipes all non-system schemas before a "replace" restore.
 *
 * `pg_restore --clean --if-exists` drops objects one by one **without CASCADE**
 * → fails in a chain on FKs between tables (e.g. `users_pkey` referenced by
 * `api_keys_user_id_users_id_fk`, etc.). Result: 42 errors and the DB stays
 * in its original state instead of being replaced.
 *
 * Solution: drop the `public` schema (and `drizzle` if present) with CASCADE,
 * then let pg_restore recreate everything from the dump.
 */
async function wipeSchemasForRestore(): Promise<void> {
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 1 });
  try {
    // Terminate other app connections to release the locks on public.*
    // (our connection stays — pg_backend_pid() is excluded).
    await sql.unsafe(`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
    `).catch(() => {});

    // Drop non-system schemas. `drizzle` contains __drizzle_migrations,
    // it will be recreated by the dump (which holds its own migration state).
    await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
    await sql.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await sql.unsafe(`CREATE SCHEMA public`);
    await sql.unsafe(`GRANT ALL ON SCHEMA public TO public`);
    logger.info("import", "public + drizzle schemas wiped before pg_restore");
  } finally {
    await sql.end();
  }
}

async function restoreToLiveDb(dumpPath: string): Promise<void> {
  const { host, port, user, password, database } = parseDatabaseUrl();

  // Step 1 — Wipe the DB (drop + recreate public) to avoid the cascading
  // errors of `--clean --if-exists` on FK dependencies.
  await wipeSchemasForRestore();

  // Step 2 — pg_restore on an empty schema (no need for --clean anymore).
  if (await hasPgRestoreLocal()) {
    const env = { ...process.env, PGPASSWORD: password };
    await execFileAsync("pg_restore", [
      "-h", host, "-p", port, "-U", user,
      "-d", database,
      "--no-owner", "--no-privileges",
      dumpPath,
    ], { env, timeout: RESTORE_TIMEOUT_MS });
  } else {
    const containerName = getDockerContainer();
    const tmpPath = "/tmp/humble_replace.dump";

    await execFileAsync("docker", [
      "cp", dumpPath, `${containerName}:${tmpPath}`,
    ], { timeout: 60000 });

    await execFileAsync("docker", [
      "exec", "-e", `PGPASSWORD=${password}`, containerName,
      "pg_restore", "-U", user, "-d", database,
      "--no-owner", "--no-privileges", tmpPath,
    ], { timeout: RESTORE_TIMEOUT_MS });

    execFileAsync("docker", ["exec", containerName, "rm", "-f", tmpPath]).catch(() => {});
  }

  // Step 3 — Ensure drizzle tracking. If the source dump did not contain
  // the `drizzle` schema (partial `--schema=public` dump, targeted export,
  // etc.), `bun run db:migrate` would try to re-apply 0000 and crash
  // with `relation "xxx" already exists` on the next deployment. We
  // always rebuild the __drizzle_migrations table from the local
  // files — idempotent thanks to ON CONFLICT DO NOTHING.
  await ensureDrizzleTracking();
}

/**
 * Rebuilds the `drizzle.__drizzle_migrations` table from the migration
 * files present in `src/db/migrations/`. Safe to call several times
 * (ON CONFLICT DO NOTHING). Uses the same hash algorithm as drizzle-kit
 * (raw sha256 of the .sql file) and the journal `when` as `created_at`.
 */
async function ensureDrizzleTracking(): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "src/db/migrations");
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    logger.warn("import", "meta/_journal.json not found — drizzle tracking not rebuilt");
    return;
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = (journal.entries ?? []) as Array<{ tag: string; when: number }>;
  if (entries.length === 0) {
    logger.warn("import", "Empty drizzle journal — nothing to insert");
    return;
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    let inserted = 0;
    for (const entry of entries) {
      const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const content = fs.readFileSync(sqlPath, "utf8");
      const hash = crypto.createHash("sha256").update(content).digest("hex");

      const [existing] = await sql`
        SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1
      `;
      if (!existing) {
        await sql`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${hash}, ${entry.when})
        `;
        inserted++;
      }
    }
    logger.info("import", `Drizzle tracking ensured (${inserted} migration(s) added, ${entries.length - inserted} already present)`);
  } finally {
    await sql.end();
  }
}

// --- Analysis ---

async function analyzeTempDb(): Promise<ImportAnalysis> {
  const tempUrl = buildConnectionUrl(TEMP_DB_NAME);
  const liveUrl = process.env.DATABASE_URL!;

  const tempSql = postgres(tempUrl, { max: 1 });
  const liveSql = postgres(liveUrl, { max: 1 });

  try {
    const tables: TableAnalysis[] = [];
    let totalInDump = 0;
    let totalConflicts = 0;

    for (const table of ANALYZABLE_TABLES) {
      // Check if table exists in temp DB
      const [exists] = await tempSql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${table}
        ) AS exists
      `;

      if (!exists?.exists) {
        tables.push({ table, countInDump: 0, countInLive: 0, conflictCount: 0 });
        continue;
      }

      const [dumpCount] = await tempSql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);
      const [liveCount] = await liveSql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);

      let conflictCount = 0;
      if (dumpCount.count > 0 && liveCount.count > 0) {
        // Check if table has an `id` column
        const [hasId] = await tempSql`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'id'
          ) AS exists
        `;

        if (hasId?.exists) {
          const dumpIds = await tempSql.unsafe(`SELECT id::text FROM "${table}"`);
          if (dumpIds.length > 0) {
            const ids = dumpIds.map((r: any) => r.id);
            const [conflicts] = await liveSql.unsafe(
              `SELECT count(*)::int AS count FROM "${table}" WHERE id = ANY($1::uuid[])`,
              [ids]
            ).catch(() => [{ count: 0 }]);
            conflictCount = conflicts?.count ?? 0;
          }
        }
      }

      totalInDump += dumpCount.count;
      totalConflicts += conflictCount;
      tables.push({ table, countInDump: dumpCount.count, countInLive: liveCount.count, conflictCount });
    }

    return { tables, totalInDump, totalConflicts, valid: true };
  } finally {
    await tempSql.end();
    await liveSql.end();
  }
}

// --- Merge import ---

/**
 * Merge import using pg_dump --data-only --inserts per table,
 * then replay into the live DB with ON CONFLICT DO NOTHING.
 * This avoids JS type serialization issues.
 */
async function executeMergeImport(): Promise<Record<string, number>> {
  const { host, port, user, password, database } = parseDatabaseUrl();
  const liveUrl = process.env.DATABASE_URL!;
  const liveSql = postgres(liveUrl, { max: 1 });
  const inserted: Record<string, number> = {};

  try {
    for (const table of MERGE_IMPORT_ORDER) {
      // Check if table exists in temp DB by trying to count
      try {
        const countResult = await getTempTableCount(host, port, user, password, table);
        if (countResult === 0) { inserted[table] = 0; continue; }
      } catch {
        continue; // Table doesn't exist in dump
      }

      // Get count before insert
      const [before] = await liveSql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`).catch(() => [{ count: 0 }]);

      // Use pg_dump to extract INSERT statements for this table, then run them
      try {
        const dumpSql = await dumpTableInserts(host, port, user, password, table);
        if (dumpSql.trim()) {
          // Replace INSERT INTO with INSERT INTO ... ON CONFLICT DO NOTHING
          const safeInserts = dumpSql
            .split("\n")
            .filter((line: string) => line.startsWith("INSERT INTO"))
            .map((line: string) => {
              // Remove trailing semicolon, add ON CONFLICT DO NOTHING
              const clean = line.replace(/;\s*$/, "");
              return `${clean} ON CONFLICT DO NOTHING;`;
            })
            .join("\n");

          if (safeInserts.trim()) {
            await liveSql.unsafe(safeInserts).catch((err: any) => {
              logger.error("import", `Insert error ${table}: ${err.message}`);
            });
          }
        }
      } catch (err) {
        logger.error("import", `Dump/insert error ${table}: ${err}`);
      }

      // Get count after insert
      const [after] = await liveSql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`).catch(() => [{ count: 0 }]);
      inserted[table] = Math.max(0, (after?.count ?? 0) - (before?.count ?? 0));
    }
    return inserted;
  } finally {
    await liveSql.end();
  }
}

async function getTempTableCount(host: string, port: string, user: string, password: string, table: string): Promise<number> {
  const tempUrl = buildConnectionUrl(TEMP_DB_NAME);
  const sql = postgres(tempUrl, { max: 1 });
  try {
    const [result] = await sql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);
    return result?.count ?? 0;
  } finally {
    await sql.end();
  }
}

async function dumpTableInserts(host: string, port: string, user: string, password: string, table: string): Promise<string> {
  if (await hasPgRestoreLocal()) {
    // Use pg_dump with --data-only --inserts on the temp DB
    const env = { ...process.env, PGPASSWORD: password };
    try {
      const hasPgDump = await new Promise<boolean>((resolve) => {
        execFile("pg_dump", ["--version"], { timeout: 5000 }, (err) => resolve(!err));
      });
      if (hasPgDump) {
        const { stdout } = await execFileAsync("pg_dump", [
          "-h", host, "-p", port, "-U", user, "-d", TEMP_DB_NAME,
          "--data-only", "--inserts", "--no-owner", "--no-privileges",
          "-t", table,
        ], { env, timeout: RESTORE_TIMEOUT_MS, maxBuffer: 100 * 1024 * 1024 });
        return stdout;
      }
    } catch { /* fall through to docker */ }
  }

  // Docker fallback
  const containerName = getDockerContainer();
  const { stdout } = await execFileAsync("docker", [
    "exec", "-e", `PGPASSWORD=${password}`, containerName,
    "pg_dump", "-U", user, "-d", TEMP_DB_NAME,
    "--data-only", "--inserts", "--no-owner", "--no-privileges",
    "-t", table,
  ], { timeout: RESTORE_TIMEOUT_MS, maxBuffer: 100 * 1024 * 1024 });
  return stdout;
}

// --- Public API ---

export async function analyzeImport(dumpBuffer: Buffer): Promise<ImportAnalysis> {
  ensureImportDir();
  const dumpPath = getDumpPath();
  fs.writeFileSync(dumpPath, dumpBuffer);
  return analyzeImportFromDisk();
}

/**
 * Analyzes a dump already written to disk (streamed directly by the route
 * handler, without going through an in-memory Buffer). Same validation,
 * temp DB restore and cleanup-on-error logic.
 */
export async function analyzeImportFromDisk(): Promise<ImportAnalysis> {
  ensureImportDir();
  const dumpPath = getDumpPath();

  if (!fs.existsSync(dumpPath)) {
    throw new AppError("settings.errors.importNoFileOnDisk");
  }

  const sizeOnDisk = fs.statSync(dumpPath).size;
  logger.info("import", `Starting dump analysis (${sizeOnDisk} bytes on disk)`);

  if (!validateDumpFile(dumpPath)) {
    fs.unlinkSync(dumpPath);
    throw new AppError("settings.errors.importInvalidDump");
  }

  try {
    await createTempDatabase();
    await restoreToTempDb(dumpPath);
    return await analyzeTempDb();
  } catch (err) {
    await dropTempDatabase().catch(() => {});
    // Do NOT delete the dump on error — allows diagnosing a
    // truncation. Cleanup happens after a successful run or via
    // cleanupImport().
    const sizeAtFail = fs.existsSync(dumpPath) ? fs.statSync(dumpPath).size : 0;
    logger.error("import", `Restore failed, file kept for diagnosis (${sizeAtFail} bytes): ${dumpPath}`);
    // Technical detail (pg_restore…) passed as is as a parameter.
    throw new AppError("settings.errors.importAnalysisFailed", {
      status: 500,
      params: { detail: err instanceof Error ? err.message : String(err) },
    });
  }
}

export function ensureImportDirExported() {
  ensureImportDir();
}

export async function executeImport(mode: "merge" | "replace", userId: string): Promise<ImportResult> {
  const dumpPath = getDumpPath();

  if (!fs.existsSync(dumpPath)) {
    throw new AppError("settings.errors.importNoPending");
  }

  try {
    if (mode === "merge") {
      const inserted = await executeMergeImport();
      // Imported dump may carry its own roles — restore the Super Administrateur
      // role if it was missing or stripped of its system/admin flags.
      try {
        const { ensureSuperAdminRole } = await import("./role-service");
        await ensureSuperAdminRole();
      } catch { /* non-critical */ }
      // An import can change roles, teams, BUs, projects, tasks, task_users…
      // The in-memory cache (permissions / scope / config / audit) may become
      // entirely stale → a blanket flush is simpler
      // and more robust than fine-grained tracking per entity.
      try {
        const { clearCache } = await import("@/lib/cache");
        clearCache();
      } catch { /* non-critical */ }
      logger.info("import", `Merge import completed by ${userId}`);
      return { success: true, mode: "merge", inserted };
    } else {
      await restoreToLiveDb(dumpPath);

      // After pg_restore --clean, clean up the live DB:
      try {
        const liveSql = postgres(process.env.DATABASE_URL!, { max: 1 });
        // Remove orphan "in_progress" backup records from the restored data
        await liveSql.unsafe(`DELETE FROM backup_history WHERE status = 'in_progress'`);
        // Invalidate all sessions — users from the dump may differ from current users
        await liveSql.unsafe(`DELETE FROM session`);
        await liveSql.end();
      } catch { /* non-critical */ }

      // A full replace import wipes the roles table — recreate the Super
      // Administrateur role so admin access is never lost after a restore.
      try {
        const { ensureSuperAdminRole } = await import("./role-service");
        await ensureSuperAdminRole();
      } catch { /* non-critical */ }

      // Purge orphaned files from the previous installation — the restored
      // dump contains its own task/user data, so old uploads are now stale.
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        for (const subDir of ["tasks", "avatars"]) {
          const dir = path.resolve(process.cwd(), "uploads", subDir);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.mkdirSync(dir, { recursive: true });
          }
        }
        // Also purge old backups (they belong to the previous DB state)
        const backupDir = path.resolve(process.cwd(), "data/backups");
        if (fs.existsSync(backupDir)) {
          for (const file of fs.readdirSync(backupDir)) {
            try { fs.unlinkSync(path.join(backupDir, file)); } catch { /* ignore */ }
          }
        }
        logger.info("import", "Orphan files purged (uploads + backups)");
      } catch { /* non-critical */ }

      // In replace mode, the whole DB was swapped → flush the entire
      // in-memory cache (permissions / scope / config / audit / etc.).
      try {
        const { clearCache } = await import("@/lib/cache");
        clearCache();
      } catch { /* non-critical */ }

      logger.info("import", `Replace import completed by ${userId}`);
      return { success: true, mode: "replace", forceReload: true };
    }
  } finally {
    // Always cleanup after execution
    await cleanupImport();
  }
}

export async function cleanupImport(): Promise<void> {
  const dumpPath = getDumpPath();
  await dropTempDatabase().catch(() => {});
  if (fs.existsSync(dumpPath)) {
    fs.unlinkSync(dumpPath);
  }
  logger.info("import", "Import cleanup finished");
}
