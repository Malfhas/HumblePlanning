import { db } from "@/db";
import { auditLogs, tasks, taskUsers, projects, users, appConfig } from "@/db/schema";
import { eq, and, gt, gte, lte, sql, desc, ne, inArray } from "drizzle-orm";
import { emitAuditEvent } from "@/lib/socket-events";
import { cached } from "@/lib/cache";
import { AppError } from "@/lib/errors";

// Whitelists per entity type
const TASK_FIELDS = [
  "title", "notes", "startDate", "endDate", "startTime", "endTime",
  "projectId", "statusId", "placeId", "resourceId", "isMilestone", "link", "customField",
  "duration", "durationDetails", "breakDuration", "parentId",
] as const;

const PROJECT_FIELDS = [
  "name", "color", "status", "groupId", "ownerId", "description",
  "deliveryDate", "iteration", "budgetAmount", "budgetTime",
] as const;

const USER_FIELDS = [
  "name", "email", "teamId", "active", "color", "rights",
] as const;

const FIELD_WHITELIST: Record<string, readonly string[]> = {
  task: TASK_FIELDS,
  project: PROJECT_FIELDS,
  user: USER_FIELDS,
};

export type AuditAction =
  | "create" | "update" | "delete" | "move" | "resize" | "copy"
  | "login" | "login_fail" | "restore" | "purge"
  | "file_upload" | "file_delete" | "email_sent" | "password_change"
  | "config_change" | "archive"
  | "api_key_create" | "api_key_delete"
  | "mcp_key_create" | "mcp_key_delete"
  | "2fa_enable" | "2fa_disable" | "2fa_fail"
  | "bruteforce_lock" | "session_revoke"
  | "update_triggered" | "migrate"
  | "email_blocked" | "email_unblocked" | "webhook_received";

interface LogAuditParams {
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  changeCount?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Audit module config — cached for performance (checked on every logAudit)
// ────────────────────────────────────────────────────────────────────────

interface AuditConfig {
  moduleEnabled: boolean;
  auditTasks: boolean;
  auditProjects: boolean;
  auditUsers: boolean;
  auditLogins: boolean;
}

async function loadAuditConfig(): Promise<AuditConfig> {
  return cached("audit:config", async () => {
    const rows = await db
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(
        inArray(appConfig.key, [
          "MODULE_AUDIT",
          "AUDIT_TASKS",
          "AUDIT_PROJECTS",
          "AUDIT_USERS",
          "AUDIT_LOGINS",
        ])
      );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      moduleEnabled: map.get("MODULE_AUDIT") !== "false",
      auditTasks: map.get("AUDIT_TASKS") !== "false",
      auditProjects: map.get("AUDIT_PROJECTS") !== "false",
      auditUsers: map.get("AUDIT_USERS") !== "false",
      auditLogins: map.get("AUDIT_LOGINS") !== "false",
    };
  }, 2 * 60 * 1000); // 2 min cache
}

/** Map entityType → config flag */
const ENTITY_TYPE_CONFIG_MAP: Record<string, keyof AuditConfig> = {
  task: "auditTasks",
  project: "auditProjects",
  project_group: "auditProjects",
  user: "auditUsers",
};

/** Actions related to login/auth (gated by AUDIT_LOGINS). */
const LOGIN_ACTIONS = new Set([
  "login", "login_fail", "bruteforce_lock", "session_revoke",
  "2fa_enable", "2fa_disable", "2fa_fail",
]);

/**
 * Returns true if the module is enabled AND the specific entity/action
 * category is not disabled. Called once per logAudit to decide whether
 * to actually insert the row.
 */
async function shouldLog(params: LogAuditParams): Promise<boolean> {
  const cfg = await loadAuditConfig();
  if (!cfg.moduleEnabled) return false;

  // Login-related actions
  if (LOGIN_ACTIONS.has(params.action)) {
    return cfg.auditLogins;
  }

  // Entity-specific actions
  const configKey = ENTITY_TYPE_CONFIG_MAP[params.entityType];
  if (configKey) {
    return cfg[configKey];
  }

  // All other entity types (config, holiday, vehicle, etc.) are always logged
  // when the module is enabled.
  return true;
}

export async function logAudit(params: LogAuditParams) {
  // Check audit module config (cached 2 min)
  if (!(await shouldLog(params))) return;

  await db.insert(auditLogs).values({
    userId: params.userId ?? undefined,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? undefined,
    oldValues: params.oldValues ?? undefined,
    newValues: params.newValues ?? undefined,
    metadata: params.metadata ?? undefined,
    changeCount: params.changeCount ?? undefined,
  });

  // Notify clients in real-time
  emitAuditEvent();

  // Auto-purge based on retention policy (fire-and-forget)
  applyRetentionPolicy().catch(() => {});
}

// Throttle: run retention purge at most once per hour
let lastRetentionCheck = 0;

async function applyRetentionPolicy() {
  const now = Date.now();
  if (now - lastRetentionCheck < 3600_000) return;
  lastRetentionCheck = now;

  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, "AUDIT_RETENTION"),
  });
  const days = parseInt(row?.value ?? "30", 10);
  if (!days || days <= 0) return; // 0 = unlimited

  const cutoff = new Date(now - days * 86400_000);
  await db.delete(auditLogs).where(lte(auditLogs.timestamp, cutoff));
}

export function computeChanges(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  entityType: string
): { old: Record<string, unknown>; new: Record<string, unknown>; count: number } | null {
  const fields = FIELD_WHITELIST[entityType];
  if (!fields) return null;

  const oldDiff: Record<string, unknown> = {};
  const newDiff: Record<string, unknown> = {};
  let count = 0;

  for (const field of fields) {
    const oldVal = oldObj[field] ?? null;
    const newVal = newObj[field];
    if (newVal === undefined) continue;
    const newValNorm = newVal ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newValNorm)) {
      oldDiff[field] = oldVal;
      newDiff[field] = newValNorm;
      count++;
    }
  }

  if (count === 0) return null;
  return { old: oldDiff, new: newDiff, count };
}

// Required fields to be able to re-insert a deleted entity
const DELETE_EXTRA_FIELDS: Record<string, readonly string[]> = {
  task: ["id", "projectId", "statusId", "startDate", "creatorId", "lastModifierId"],
  project: ["id", "ownerId"],
  user: ["id"],
};

// Pick only whitelisted fields from an object (+ required fields for delete snapshots)
export function pickAuditFields(obj: Record<string, unknown>, entityType: string, forDelete = false): Record<string, unknown> {
  const fields = FIELD_WHITELIST[entityType];
  if (!fields) return {};
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in obj) result[field] = obj[field];
  }
  if (forDelete) {
    const extra = DELETE_EXTRA_FIELDS[entityType] ?? [];
    for (const field of extra) {
      if (field in obj) result[field] = obj[field];
    }
  }
  return result;
}

interface AuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  dateStart?: string;
  dateEnd?: string;
  search?: string;
  source?: string;
  page: number;
  limit: number;
}

export async function getAuditLogs(filters: AuditFilters) {
  const conditions = [];

  if (filters.entityType) {
    const types = filters.entityType.split(",").filter(Boolean);
    conditions.push(types.length === 1 ? eq(auditLogs.entityType, types[0]) : inArray(auditLogs.entityType, types));
  }
  if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
  if (filters.action) {
    const actions = filters.action.split(",").filter(Boolean);
    conditions.push(actions.length === 1 ? eq(auditLogs.action, actions[0]) : inArray(auditLogs.action, actions));
  }
  if (filters.userId) {
    const userIds = filters.userId.split(",").filter(Boolean);
    conditions.push(userIds.length === 1 ? eq(auditLogs.userId, userIds[0]) : inArray(auditLogs.userId, userIds));
  }
  if (filters.dateStart) conditions.push(gte(auditLogs.timestamp, new Date(filters.dateStart)));
  if (filters.dateEnd) conditions.push(lte(auditLogs.timestamp, new Date(filters.dateEnd + "T23:59:59.999Z")));
  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    conditions.push(
      sql`(
        ${auditLogs.metadata}::text ILIKE ${searchTerm}
        OR ${auditLogs.oldValues}::text ILIKE ${searchTerm}
        OR ${auditLogs.newValues}::text ILIKE ${searchTerm}
      )`
    );
  }
  if (filters.source && filters.source !== "all") {
    conditions.push(sql`${auditLogs.metadata}->>'source' = ${filters.source}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (filters.page - 1) * filters.limit;

  const [data, countResult] = await Promise.all([
    db.query.auditLogs.findMany({
      where,
      with: { user: { columns: { id: true, name: true, firstName: true } } },
      limit: filters.limit,
      offset,
      orderBy: [desc(auditLogs.timestamp)],
    }),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(where),
  ]);

  // Resolve entity names for tasks/projects/users that may not have title in values
  const entityIds = new Set<string>();
  for (const log of data) {
    if (log.entityId) entityIds.add(log.entityId);
  }
  const entityNames: Record<string, string> = {};
  if (entityIds.size > 0) {
    const ids = Array.from(entityIds);
    const [taskRows, projectRows, userRows] = await Promise.all([
      db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, ids)),
      db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids)),
      db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)),
    ]);
    for (const r of taskRows) { if (r.title) entityNames[r.id] = r.title; }
    for (const r of projectRows) { entityNames[r.id] = r.name; }
    for (const r of userRows) { if (r.name) entityNames[r.id] = r.name; }
  }

  return {
    data,
    entityNames,
    total: Number(countResult[0].count),
    page: filters.page,
    limit: filters.limit,
  };
}

export async function getAuditLogById(id: string) {
  return db.query.auditLogs.findFirst({
    where: eq(auditLogs.id, id),
    with: { user: { columns: { id: true, name: true, firstName: true } } },
  });
}

export async function purgeAuditLogs(before: Date) {
  const result = await db.delete(auditLogs)
    .where(lte(auditLogs.timestamp, before))
    .returning({ id: auditLogs.id });
  return result.length;
}

// Actions that represent real data changes and should be cascaded
const CASCADABLE_ACTIONS = new Set(["update", "delete", "move", "resize"]);

export async function restoreFromAudit(logId: string, userId: string) {
  const log = await getAuditLogById(logId);
  if (!log) throw new AppError("admin.audit.errors.notFound");
  if (!log.oldValues) throw new AppError("admin.audit.errors.nothingToRestore");
  if (!log.entityId) throw new AppError("admin.audit.errors.missingEntityId");

  const oldValues = log.oldValues as Record<string, unknown>;

  // ── Cascade: find all newer logs for the same entity ──
  // Use gte + id exclusion for robustness (same-millisecond logs)
  const newerLogs = log.action !== "delete"
    ? await db.query.auditLogs.findMany({
        where: and(
          eq(auditLogs.entityType, log.entityType),
          eq(auditLogs.entityId, log.entityId),
          gte(auditLogs.timestamp, log.timestamp),
          ne(auditLogs.id, log.id),
        ),
        orderBy: [desc(auditLogs.timestamp)],
      })
    : [];

  // Only cascade real data changes (not create, copy, restore, login)
  const cascadableLogs = newerLogs.filter((l) => CASCADABLE_ACTIONS.has(l.action));
  const deleteLog = cascadableLogs.find((l) => l.action === "delete");
  const needsInsert = log.action === "delete" || !!deleteLog;

  // ── Build the target state by cascading all changes ──
  let targetState: Record<string, unknown>;

  if (log.action === "delete") {
    // Restoring the delete itself — use its own oldValues (full snapshot)
    targetState = { ...oldValues };
  } else if (deleteLog) {
    // Entity was deleted after this log — start from delete snapshot (full state)
    // then apply intermediate logs' oldValues (newest first) + target log's oldValues
    targetState = { ...(deleteLog.oldValues as Record<string, unknown>) };
    const intermediateLogs = cascadableLogs
      .filter((l) => l.action !== "delete" && l.oldValues)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    for (const iLog of intermediateLogs) {
      const iOld = iLog.oldValues as Record<string, unknown>;
      for (const [key, value] of Object.entries(iOld)) {
        targetState[key] = value;
      }
    }
    // Apply the target log's oldValues last (highest priority)
    for (const [key, value] of Object.entries(oldValues)) {
      targetState[key] = value;
    }
  } else {
    // Entity still exists — merge target + all newer logs' oldValues (cascade undo)
    targetState = {};
    // Apply newest first, then older — oldest (target) wins for same keys
    for (const nLog of cascadableLogs.filter((l) => l.oldValues)) {
      const nOld = nLog.oldValues as Record<string, unknown>;
      for (const [key, value] of Object.entries(nOld)) {
        targetState[key] = value;
      }
    }
    // Target log's oldValues applied last — takes priority
    for (const [key, value] of Object.entries(oldValues)) {
      targetState[key] = value;
    }
  }

  // Remove snapshot-only fields that are not DB columns
  delete targetState.id;

  // ── Apply the restored state ──
  switch (log.entityType) {
    case "task": {
      const { userIds, ...taskValues } = targetState;
      if (needsInsert) {
        await db.insert(tasks).values({ ...taskValues, id: log.entityId } as typeof tasks.$inferInsert);
        const uids = Array.isArray(userIds) ? (userIds as string[]) : [];
        if (uids.length > 0) {
          await db.insert(taskUsers).values(
            uids.map((uid) => ({ taskId: log.entityId!, userId: uid })),
          );
        }
      } else {
        await db.update(tasks).set(taskValues).where(eq(tasks.id, log.entityId));
      }
      break;
    }
    case "project": {
      if (needsInsert) {
        await db.insert(projects).values({ ...targetState, id: log.entityId } as typeof projects.$inferInsert);
      } else {
        await db.update(projects).set(targetState).where(eq(projects.id, log.entityId));
      }
      break;
    }
    case "user": {
      if (needsInsert) {
        await db.update(users).set({ ...targetState, active: true }).where(eq(users.id, log.entityId));
      } else {
        await db.update(users).set(targetState).where(eq(users.id, log.entityId));
      }
      break;
    }
    default:
      throw new AppError("admin.audit.errors.unsupportedEntityType", { params: { entityType: log.entityType } });
  }

  // ── Delete cascaded audit logs (they are now obsolete) ──
  if (cascadableLogs.length > 0) {
    const cascadedIds = cascadableLogs.map((l) => l.id);
    await db.delete(auditLogs).where(inArray(auditLogs.id, cascadedIds));
  }

  // ── Also delete the restored log itself (it has been undone) ──
  await db.delete(auditLogs).where(eq(auditLogs.id, log.id));

  // Log the restore action (single entry replaces all cascaded logs)
  await logAudit({
    userId,
    action: "restore",
    entityType: log.entityType,
    entityId: log.entityId,
    oldValues: log.newValues as Record<string, unknown> | null,
    newValues: targetState,
    metadata: {
      restoredFromLogId: logId,
      cascadedLogs: cascadableLogs.length > 0 ? cascadableLogs.length : undefined,
    },
  });

  return log;
}
