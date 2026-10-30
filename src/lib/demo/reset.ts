import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, ne, sql, type InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import * as schema from "@/db/schema";
import { clearCache } from "@/lib/cache";
import { hashPassword } from "@/lib/password";
import { buildDemoDataset } from "./dataset";
import { DEMO_ROLE_ID, DEMO_ROLE_PERMISSIONS, getDemoCredentials } from "./index";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Kept by the reset: settings and roles, which visitors cannot change. */
const KEPT_TABLES = ["app_config", "roles", "role_permissions"];
/** Written by every reset. Without it, the data was not created by the demo and is never erased silently. */
export const DEMO_MARKER_KEY = "DEMO_DATASET_AT";
/** Transaction-level advisory lock: one reset at a time, whatever the process. */
const LOCK_KEY = 4261030;
const UPLOAD_DIRS = ["avatars", "files", "tasks"];
const BATCH = 500;

export type DemoResetResult =
  | { status: "done"; users: number; projects: number; tasks: number; ms: number }
  | { status: "refused"; users: number }
  | { status: "busy" };

/**
 * Erases every piece of data (except settings and roles) and loads the demo
 * dataset for `today`, in one transaction. Refuses a database whose data was
 * not created by the demo, unless `force`.
 */
export async function resetDemoData(db: Database, options: { today: string; force?: boolean }): Promise<DemoResetResult> {
  const credentials = getDemoCredentials();
  if (!credentials) throw new Error("Demo mode is not enabled (DEMO_MODE=true)");
  const started = Date.now();
  const data = buildDemoDataset(options.today, { login: credentials.login });
  const passwordHash = await hashPassword(credentials.password);

  const result = await db.transaction(async (tx): Promise<DemoResetResult> => {
    const [lock] = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`);
    if (!lock?.locked) return { status: "busy" };

    const marker = await tx.select({ key: schema.appConfig.key }).from(schema.appConfig).where(eq(schema.appConfig.key, DEMO_MARKER_KEY));
    if (marker.length === 0 && !options.force) {
      const [{ count }] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM users`);
      if (count > 0) return { status: "refused", users: count };
    }

    // Every other table of the schema, so that tables added later are erased too
    const tables = await tx.execute<{ name: string }>(sql`
      SELECT tablename AS name FROM pg_tables
      WHERE schemaname = current_schema() AND tablename NOT IN (${sql.join(KEPT_TABLES.map((t) => sql`${t}`), sql`, `)})`);
    const list = tables.map((t) => `"${t.name.replace(/"/g, '""')}"`).join(", ");
    if (list) await tx.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));

    await resetDemoRole(tx);
    // Users keep their role only if it exists (the base seed creates roles 1 to 5)
    const roleIds = new Set((await tx.select({ id: schema.roles.id }).from(schema.roles)).map((r) => r.id));
    const users = data.users.map((u) => ({ ...u, roleId: u.roleId && roleIds.has(u.roleId) ? u.roleId : null }));

    const insert = async <T extends PgTable>(table: T, rows: InferInsertModel<T>[]) => {
      for (let i = 0; i < rows.length; i += BATCH) await tx.insert(table).values(rows.slice(i, i + BATCH) as never);
    };
    await insert(schema.statuses, data.statuses);
    await insert(schema.businessUnits, data.businessUnits);
    await insert(schema.teams, data.teams);
    await insert(schema.laborTypes, data.laborTypes);
    await insert(schema.qualifications, data.qualifications);
    await insert(schema.users, users);
    const accountUserId = users.find((u) => u.username === credentials.login)!.id!;
    await insert(schema.accounts, [{ id: randomUUID(), userId: accountUserId, accountId: accountUserId, providerId: "credential", password: passwordHash }]);
    await insert(schema.userQualifications, data.userQualifications);
    await insert(schema.places, data.places);
    await insert(schema.vehicleTypes, data.vehicleTypes);
    await insert(schema.vehicles, data.vehicles);
    await insert(schema.resourceTypes, data.resourceTypes);
    await insert(schema.resources, data.resources);
    await insert(schema.projectGroups, data.projectGroups);
    await insert(schema.projects, data.projects);
    await insert(schema.projectLaborBudgets, data.projectLaborBudgets);
    await insert(schema.tasks, data.tasks);
    await insert(schema.taskUsers, data.taskUsers);
    await insert(schema.vehicleAssignments, data.vehicleAssignments);
    await insert(schema.resourceAssignments, data.resourceAssignments);
    await insert(schema.holidays, data.holidays);

    const at = new Date().toISOString();
    await tx.insert(schema.appConfig)
      .values({ key: DEMO_MARKER_KEY, value: at, description: "Last reset of the demo data" })
      .onConflictDoUpdate({ target: schema.appConfig.key, set: { value: at } });

    return { status: "done", users: users.length, projects: data.projects.length, tasks: data.tasks.length, ms: 0 };
  });

  if (result.status === "done") {
    await removeUploads();
    clearCache();
    result.ms = Date.now() - started;
  }
  return result;
}

/** The "Démo" role: business permissions only. Custom roles cannot exist in demo mode. */
async function resetDemoRole(tx: Transaction) {
  await tx.delete(schema.roles).where(eq(schema.roles.isSystem, false));
  await tx.delete(schema.roles).where(and(eq(schema.roles.name, "Démo"), ne(schema.roles.id, DEMO_ROLE_ID)));
  const role = {
    name: "Démo",
    description: "Compte de démonstration : toutes les fonctions métier, sans administration.",
    isSystem: true,
    isAdmin: false,
    color: "#0f766e",
  };
  await tx.insert(schema.roles).values({ id: DEMO_ROLE_ID, ...role }).onConflictDoUpdate({ target: schema.roles.id, set: role });
  await tx.delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, [DEMO_ROLE_ID]));
  await tx.insert(schema.rolePermissions).values(DEMO_ROLE_PERMISSIONS.map((permission) => ({ roleId: DEMO_ROLE_ID, permission })));
}

/** Uploaded files belong to the erased data (branding is kept). */
async function removeUploads() {
  for (const dir of UPLOAD_DIRS) {
    const path = join(process.cwd(), "uploads", dir);
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });
  }
}
