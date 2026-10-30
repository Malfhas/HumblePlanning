/**
 * provision.ts — Non-interactive provisioning commands for Humble Planning.
 *
 * Called by `install.sh` (through the Docker image) and by `docker-entrypoint.sh`.
 * It never prompts: all user interaction lives in install.sh.
 *
 * Usage (from the project root, DATABASE_URL in the environment or in .env):
 *   bun src/scripts/provision.ts check-db [--url-stdin]
 *   bun src/scripts/provision.ts migrate
 *   bun src/scripts/provision.ts password-rules
 *   bun src/scripts/provision.ts check-password            < password
 *   bun src/scripts/provision.ts admin-status
 *   bun src/scripts/provision.ts create-admin <username> [--additional] < password
 *   bun src/scripts/provision.ts backup                    > file.dump
 *   bun src/scripts/provision.ts restore                   < file.dump
 *   bun src/scripts/provision.ts demo-reset [--force]      (DEMO_MODE=true only)
 *
 * Secrets (passwords, connection URL with --url-stdin) are read on stdin, never
 * from argv or the environment of the caller.
 *
 * Output protocol — one message per line on stdout, easy to parse from bash:
 *   OK<TAB>text | INFO<TAB>text | WARN<TAB>text | ERR<TAB>text | DATA<TAB>key=value
 * Diagnostics (child process output, stack traces) go to stderr.
 * Exception: `backup` writes the pg_dump archive (custom format) on stdout.
 *
 * Exit codes:
 *   0 success
 *   1 runtime error (connection, SQL, seed…)
 *   2 invalid input (usage, username, password policy)
 *   3 conflict (an administrator or the username already exists; demo-reset:
 *     the database holds data that was not created by the demo, use --force)
 *   4 database not suitable (server too old, missing privileges)
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, inArray } from "drizzle-orm";
import { users, accounts, appConfig } from "../db/schema";
import { hashPassword } from "../lib/password";
import { policyFromConfig, evaluatePassword, PWD_CONFIG_KEYS, type PasswordCheck, type PasswordPolicy } from "../lib/password-policy";

const MIN_SERVER_VERSION_NUM = 160000; // PostgreSQL 16
const SUPER_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000005";
const ADMINISTRATOR_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../db/migrations", import.meta.url));
const SEED_SCRIPT = fileURLToPath(new URL("../db/seed.ts", import.meta.url));
// Same rule as the installer prompt (install.sh); the app itself accepts 1–100 chars.
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,99}$/;

const EXIT = { OK: 0, ERROR: 1, INVALID: 2, CONFLICT: 3, UNSUITABLE: 4 } as const;

class ProvisionError extends Error {
  constructor(message: string, readonly code: number = EXIT.ERROR) {
    super(message);
  }
}

// ─── Output helpers ─────────────────────────────────────────────────────────

type Tag = "OK" | "INFO" | "WARN" | "ERR" | "DATA";

function out(tag: Tag, text: string) {
  // One message per line: never let a multi-line error break the protocol.
  process.stdout.write(`${tag}\t${text.replace(/\s*\n\s*/g, " ").trim()}\n`);
}

// ─── Input helpers ──────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  // Strip a single trailing line break (from `printf '%s\n'` or a heredoc),
  // keep every other character: spaces are valid in passwords.
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

// ─── Database helpers ───────────────────────────────────────────────────────

function connect(url: string | undefined) {
  if (!url) {
    throw new ProvisionError("DATABASE_URL is not set.", EXIT.INVALID);
  }
  try {
    new URL(url);
  } catch {
    throw new ProvisionError("DATABASE_URL is not a valid connection URL.", EXIT.INVALID);
  }
  return postgres(url, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => {}, // "schema drizzle already exists, skipping"…
  });
}

/** Turns driver/server errors into a single readable sentence. */
function describeDbError(err: unknown, url: string): string {
  const e = err as { code?: string; message?: string; errno?: string };
  let target = "the database server";
  let user = "";
  let database = "";
  try {
    const u = new URL(url);
    target = `${u.hostname}:${u.port || "5432"}`;
    user = decodeURIComponent(u.username);
    database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { /* keep defaults */ }

  const message = e?.message ?? String(err);
  switch (e?.code) {
    case "28P01":
      return `Authentication failed for user "${user}": wrong password.`;
    case "28000":
      return `Access denied for user "${user}" (check pg_hba.conf on the server): ${message}`;
    case "3D000":
      return `Database "${database}" does not exist on ${target}.`;
    case "ECONNREFUSED":
      return `Connection refused by ${target}. Is PostgreSQL running and listening on this address?`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Host "${target.split(":")[0]}" could not be resolved.`;
    case "CONNECT_TIMEOUT":
    case "ETIMEDOUT":
      return `Connection to ${target} timed out (firewall or wrong host?).`;
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `Host ${target} is unreachable from the container.`;
  }
  if (/does not support SSL/i.test(message)) {
    return `The server at ${target} does not support SSL. Use SSL mode "disable".`;
  }
  if (/SSL|TLS|certificate/i.test(message)) {
    return `SSL error while connecting to ${target}: ${message}`;
  }
  return `Connection to ${target} failed: ${message}`;
}

function pgDumpMajorVersion(): number | null {
  const res = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (res.status !== 0) return null;
  const match = /(\d+)(?:\.\d+)?/.exec(res.stdout ?? "");
  return match ? Number(match[1]) : null;
}

async function loadPasswordPolicy(db: ReturnType<typeof drizzle>): Promise<PasswordPolicy> {
  // Same source and same parser as user-service.ts → validatePassword():
  // app_config keys PWD_* read through policyFromConfig().
  const rows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(inArray(appConfig.key, [...PWD_CONFIG_KEYS]));
  return policyFromConfig(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

// ─── Password policy (English labels) ───────────────────────────────────────

type Criterion = { label: string; met: boolean };

/** English label of each criterion returned by evaluatePassword() (stable keys + params). */
const CRITERION_LABELS: Record<PasswordCheck["key"], (params: PasswordCheck["params"]) => string> = {
  minLength: (p) => `At least ${p?.min} characters`,
  maxLength: (p) => `At most ${p?.max} characters`,
  uppercase: () => "One uppercase letter",
  lowercase: () => "One lowercase letter",
  digit: () => "One digit",
  special: () => "One special character (!@#$...)",
};

function evaluateInEnglish(password: string, policy: PasswordPolicy): { valid: boolean; criteria: Criterion[] } {
  const strength = evaluatePassword(password, policy);
  const criteria = strength.checks.map((check) => ({ label: CRITERION_LABELS[check.key](check.params), met: check.met }));
  return { valid: strength.valid, criteria };
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdCheckDb(args: string[]): Promise<number> {
  const url = args.includes("--url-stdin") ? (await readStdin()).trim() : process.env.DATABASE_URL;
  const sql = connect(url);
  try {
    const info = await sql`
      select
        current_setting('server_version_num')::int as version_num,
        current_setting('server_version') as version,
        current_user as "user",
        current_database() as database,
        has_database_privilege(current_database(), 'CREATE') as can_create_schema,
        coalesce((select has_schema_privilege(n.oid, 'CREATE') from pg_namespace n where n.nspname = 'public'), false) as can_create_in_public,
        exists(select 1 from pg_namespace where nspname = 'drizzle') as has_drizzle_schema,
        coalesce((select rolcreatedb or rolsuper from pg_roles where rolname = current_user), false) as can_create_db
    `.then(
      (rows) => rows[0],
      (err) => {
        console.error(err);
        throw new ProvisionError(describeDbError(err, url!), EXIT.ERROR);
      },
    );

    const version = String(info.version).split(" ")[0];
    const major = Math.floor(Number(info.version_num) / 10000);
    out("DATA", `server_version=${version}`);
    out("DATA", `server_major=${major}`);

    if (Number(info.version_num) < MIN_SERVER_VERSION_NUM) {
      throw new ProvisionError(`PostgreSQL ${version} is too old: version 16 or later is required.`, EXIT.UNSUITABLE);
    }
    if (!info.can_create_in_public || !(info.can_create_schema || info.has_drizzle_schema)) {
      throw new ProvisionError(
        `User "${info.user}" cannot create tables in database "${info.database}". ` +
          `Make it the owner of the database: ALTER DATABASE "${info.database}" OWNER TO "${info.user}";`,
        EXIT.UNSUITABLE,
      );
    }

    out("OK", `Connected to PostgreSQL ${version} (database "${info.database}", user "${info.user}").`);
    if (!info.can_create_db) {
      out("WARN", `User "${info.user}" lacks the CREATEDB privilege: importing a backup from the app will not work.`);
    }
    const clientMajor = pgDumpMajorVersion();
    if (clientMajor !== null && clientMajor < major) {
      out("WARN", `The server runs PostgreSQL ${major} but the bundled pg_dump is version ${clientMajor}: in-app backups will fail.`);
    }
    return EXIT.OK;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cmdMigrate(): Promise<number> {
  const url = process.env.DATABASE_URL;
  const sql = connect(url);
  try {
    try {
      await sql`select 1`;
    } catch (err) {
      console.error(err);
      throw new ProvisionError(describeDbError(err, url!));
    }

    // Serialise concurrent runs (installer + container start, or two replicas).
    await sql`select pg_advisory_lock(hashtext('humble-planning:migrate'))`;
    try {
      const countApplied = async () => {
        const [row] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
        if (!row.present) return 0;
        const [count] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
        return Number(count.n);
      };

      const before = await countApplied();
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
      const applied = (await countApplied()) - before;
      out("OK", applied > 0 ? `Applied ${applied} database migration(s).` : "Database schema is up to date.");

      // The seed is not fully idempotent (statuses would be duplicated and
      // permissions revoked by an admin would come back), so it only runs on a
      // database that has never been seeded. app_config is filled by its last step.
      const [seeded] = await sql`select exists(select 1 from app_config) as done`;
      if (seeded.done) {
        out("INFO", "Default data already present: seed skipped.");
        return EXIT.OK;
      }

      const code = await new Promise<number>((resolve) => {
        const child = spawn(process.execPath, [SEED_SCRIPT], {
          env: { ...process.env, SEED_NO_ADMIN: "1" },
          // Keep stdout for the protocol: seed logs go to stderr (install log).
          stdio: ["ignore", process.stderr, process.stderr],
        });
        child.on("error", () => resolve(1));
        child.on("exit", (c) => resolve(c ?? 1));
      });
      if (code !== 0) throw new ProvisionError("Seeding the default data failed (see the log for details).");
      out("OK", "Default data created (roles, permissions, statuses, settings).");
      return EXIT.OK;
    } finally {
      await sql`select pg_advisory_unlock(hashtext('humble-planning:migrate'))`.catch(() => {});
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cmdPasswordRules(): Promise<number> {
  const sql = connect(process.env.DATABASE_URL);
  try {
    const policy = await loadPasswordPolicy(drizzle(sql));
    // A non-empty sample makes evaluatePassword() list every active criterion.
    for (const c of evaluateInEnglish("x", policy).criteria) out("INFO", c.label);
    return EXIT.OK;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Prints the criteria (all of them, or only when the password is refused). */
async function checkPolicy(db: ReturnType<typeof drizzle>, password: string, listAll: boolean): Promise<boolean> {
  if (!password) {
    out("ERR", "The password cannot be empty.");
    return false;
  }
  const { valid, criteria } = evaluateInEnglish(password, await loadPasswordPolicy(db));
  if (listAll || !valid) for (const c of criteria) out(c.met ? "OK" : "ERR", c.label);
  return valid;
}

async function cmdCheckPassword(): Promise<number> {
  const password = await readStdin();
  const sql = connect(process.env.DATABASE_URL);
  try {
    return (await checkPolicy(drizzle(sql), password, true)) ? EXIT.OK : EXIT.INVALID;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function findAdmins(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql`
    select u.login
    from users u
    join roles r on r.id = u.role_id
    where u.active is true
      and (r.is_admin is true or r.id = ${ADMINISTRATOR_ROLE_ID})
    order by u.created_at
  `;
  return rows.map((r) => String(r.login));
}

async function cmdAdminStatus(): Promise<number> {
  const sql = connect(process.env.DATABASE_URL);
  try {
    for (const login of await findAdmins(sql)) out("DATA", `admin=${login}`);
    return EXIT.OK;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cmdCreateAdmin(args: string[]): Promise<number> {
  const username = args.find((a) => !a.startsWith("--"));
  const additional = args.includes("--additional");
  if (!username) throw new ProvisionError("Usage: create-admin <username> [--additional] < password", EXIT.INVALID);
  if (!USERNAME_PATTERN.test(username)) {
    throw new ProvisionError(
      "Invalid username: use 2 to 100 letters, digits, dots, dashes, underscores or @, starting with a letter or a digit.",
      EXIT.INVALID,
    );
  }

  const password = await readStdin();
  const sql = connect(process.env.DATABASE_URL);
  try {
    const db = drizzle(sql);

    const admins = await findAdmins(sql);
    if (admins.length > 0 && !additional) {
      out("WARN", `An administrator account already exists: "${admins[0]}".`);
      return EXIT.CONFLICT;
    }
    const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (taken.length > 0) {
      out("ERR", `The username "${username}" is already taken.`);
      return EXIT.CONFLICT;
    }
    if (!(await checkPolicy(db, password, false))) return EXIT.INVALID;

    const hashed = await hashPassword(password);
    await db.transaction(async (tx) => {
      const [admin] = await tx.insert(users).values({
        name: "Administrateur",
        username,
        emailVerified: true,
        roleId: SUPER_ADMIN_ROLE_ID, // Super Administrateur (isAdmin bypass)
        active: true,
        color: "#7c3aed",
      }).returning({ id: users.id });

      await tx.insert(accounts).values({
        id: randomUUID(),
        userId: admin.id,
        accountId: admin.id,
        providerId: "credential",
        password: hashed,
      });
    });

    out("OK", `Administrator account "${username}" created.`);
    return EXIT.OK;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ─── Backup / restore (used by `humble-planning update` and `rollback`) ─────

/** libpq environment for the pg_* tools: the password never appears in argv. */
function pgEnv(url: string | undefined): NodeJS.ProcessEnv {
  if (!url) throw new ProvisionError("DATABASE_URL is not set.", EXIT.INVALID);
  const u = new URL(url);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: decodeURIComponent(u.hostname.replace(/^\[|\]$/g, "")),
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  delete env.DATABASE_URL;
  return env;
}

function waitExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => {
    child.on("error", (err) => { console.error(err); resolve(127); });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function cmdBackup(): Promise<number> {
  // Custom-format archive on stdout; diagnostics on stderr.
  const dump = spawn("pg_dump", ["--format=custom", "--compress=6"], {
    env: pgEnv(process.env.DATABASE_URL),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await waitExit(dump);
  if (code !== 0) console.error(`pg_dump failed with exit code ${code}`);
  return code === 0 ? EXIT.OK : EXIT.ERROR;
}

async function cmdRestore(): Promise<number> {
  // Replaces the whole database content with the archive read on stdin.
  // 1. pg_restore converts the archive into SQL in a temporary file: a
  //    truncated or corrupt archive is detected before touching the database.
  // 2. psql applies it in a single transaction, after dropping the schemas so
  //    that tables created by a newer version (and its migration history)
  //    disappear too. On any error, nothing changes.
  const env = pgEnv(process.env.DATABASE_URL);
  const dir = mkdtempSync(join(tmpdir(), "hp-restore-"));
  try {
    const sqlFile = join(dir, "restore.sql");
    const preludeFile = join(dir, "prelude.sql");
    writeFileSync(
      preludeFile,
      "SET client_min_messages = warning;\nDROP SCHEMA IF EXISTS drizzle CASCADE;\nDROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n",
    );
    const restoreCode = await waitExit(
      spawn("pg_restore", ["--no-owner", "--no-privileges", `--file=${sqlFile}`], {
        env,
        stdio: ["inherit", process.stderr, process.stderr],
      }),
    );
    if (restoreCode !== 0) {
      throw new ProvisionError(`The backup archive is unreadable (pg_restore exit code ${restoreCode}): the database was left unchanged.`);
    }
    const psqlCode = await waitExit(
      spawn("psql", ["-X", "-q", "-o", "/dev/null", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", preludeFile, "-f", sqlFile], {
        env,
        stdio: ["ignore", process.stderr, process.stderr],
      }),
    );
    if (psqlCode !== 0) {
      throw new ProvisionError(`Restore failed (psql exit code ${psqlCode}): the database was left unchanged.`);
    }
    out("OK", "Database restored from the backup.");
    return EXIT.OK;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  "check-db": cmdCheckDb,
  migrate: cmdMigrate,
  "password-rules": cmdPasswordRules,
  "check-password": cmdCheckPassword,
  "admin-status": cmdAdminStatus,
  "create-admin": cmdCreateAdmin,
  backup: cmdBackup,
  restore: cmdRestore,
  "demo-reset": cmdDemoReset,
};

/** Erases every piece of data and loads the demo dataset (see src/lib/demo). */
async function cmdDemoReset(args: string[]): Promise<number> {
  if (process.env.DEMO_MODE !== "true") {
    throw new ProvisionError("DEMO_MODE is not true in .env: demo-reset only runs on a demo instance.", EXIT.INVALID);
  }
  const sql = connect(process.env.DATABASE_URL);
  try {
    const [schema, relations, { resetDemoData }, { wallClock }, { getInstanceTimezone }] = await Promise.all([
      import("../db/schema"), import("../db/relations"), import("../lib/demo/reset"), import("../lib/demo/clock"),
      import("../lib/services/config-service"),
    ]);
    const db = drizzle(sql, { schema: { ...schema, ...relations } });
    const today = wallClock(new Date(), await getInstanceTimezone()).day;
    const result = await resetDemoData(db, { today, force: args.includes("--force") });
    if (result.status === "refused") {
      throw new ProvisionError(
        `The database holds data that was not created by the demo (${result.users} user account(s)). Run again with --force to erase everything.`,
        EXIT.CONFLICT,
      );
    }
    if (result.status === "busy") throw new ProvisionError("Another demo reset is running: try again in a minute.");
    out("OK", `Demo data loaded: ${result.users} users, ${result.projects} projects, ${result.tasks} tasks.`);
    return EXIT.OK;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const run = command ? COMMANDS[command] : undefined;
  if (!run) {
    out("ERR", `Usage: provision.ts <${Object.keys(COMMANDS).join("|")}> [options]`);
    return EXIT.INVALID;
  }
  try {
    return await run(args);
  } catch (err) {
    if (err instanceof ProvisionError) {
      out("ERR", err.message);
      return err.code;
    }
    console.error(err);
    out("ERR", `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT.ERROR;
  }
}

main().then((code) => process.exit(code));
