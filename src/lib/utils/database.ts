import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseDatabaseUrl(): { host: string; port: string; user: string; password: string; database: string } {
  const url = new URL(process.env.DATABASE_URL!);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

/** Build a connection URL pointing to a different database on the same server */
export function buildConnectionUrl(dbName: string): string {
  const { host, port, user, password } = parseDatabaseUrl();
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

/** Build a connection URL to the `postgres` maintenance database (for CREATE/DROP DATABASE) */
export function buildMaintenanceUrl(): string {
  return buildConnectionUrl("postgres");
}

export function getDockerContainer(): string {
  return process.env.BACKUP_DOCKER_CONTAINER ?? "humble-planning-postgres-1";
}

export async function hasPgDumpLocal(): Promise<boolean> {
  try {
    await execFileAsync("pg_dump", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function hasPgRestoreLocal(): Promise<boolean> {
  try {
    await execFileAsync("pg_restore", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
