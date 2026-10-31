import { db } from "@/db";
import { tasks, taskUsers } from "@/db/schema";
import { sql, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import { getConfigValue } from "./config-service";
import type { TaskAccessScope } from "./permission-service";
import { isValidStorageKey, safeUploadPath } from "@/lib/utils/upload-paths";
import { logger } from "@/lib/logger";

export interface FileEntry {
  fileId: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string | null;
  taskId: string;
  taskTitle: string | null;
  projectId: string;
  projectName: string | null;
  projectColor: string | null;
  uploaderName: string | null;
  storageKey: string | null;
}

interface FileFilters {
  search?: string;
  fileType?: "image" | "pdf" | "other";
  dateStart?: string;
  dateEnd?: string;
  page: number;
  limit: number;
}

/** `tasks` under the `t` alias of the raw queries of `getAllFiles`. */
const taskAlias = alias(tasks, "t");

/**
 * Conditions keeping the tasks of the read scope, same rule as `getTasks`:
 * allowed project and at least one visible assignee.
 */
function readScopeConditions(scope: TaskAccessScope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.accessibleProjectIds !== null) {
    if (scope.accessibleProjectIds.length === 0) return [sql`false`];
    conditions.push(inArray(taskAlias.projectId, scope.accessibleProjectIds));
  }
  if (scope.accessibleUserIds !== null) {
    if (scope.accessibleUserIds.length === 0) return [sql`false`];
    conditions.push(inArray(
      taskAlias.id,
      db.select({ id: taskUsers.taskId }).from(taskUsers).where(inArray(taskUsers.userId, scope.accessibleUserIds)),
    ));
  }
  return conditions;
}

/**
 * Attachments of the tasks in `scope` (`getTaskAccessScope`): the files page
 * lists only what the user can download (`/api/files/tasks/...`).
 */
export async function getAllFiles(filters: FileFilters, scope: TaskAccessScope): Promise<{
  data: FileEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const { search, fileType, dateStart, dateEnd, page, limit } = filters;
  const offset = (page - 1) * limit;

  // Build dynamic WHERE fragments
  const conditions: SQL[] = readScopeConditions(scope);

  if (search) {
    conditions.push(sql`(f->>'originalName' ILIKE ${'%' + search + '%'} OR f->>'storageKey' ILIKE ${'%' + search + '%'})`);
  }

  if (fileType === "image") {
    conditions.push(sql`f->>'mimeType' LIKE 'image/%'`);
  } else if (fileType === "pdf") {
    conditions.push(sql`f->>'mimeType' = 'application/pdf'`);
  } else if (fileType === "other") {
    conditions.push(sql`f->>'mimeType' NOT LIKE 'image/%' AND f->>'mimeType' != 'application/pdf'`);
  }

  if (dateStart) {
    conditions.push(sql`(f->>'uploadedAt')::timestamptz >= ${dateStart}::timestamptz`);
  }

  if (dateEnd) {
    // i18n-ignore SQL query (false positive: interval '1 day')
    conditions.push(sql`(f->>'uploadedAt')::timestamptz <= (${dateEnd}::date + interval '1 day')::timestamptz`);
  }

  const whereFragment = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT
        f->>'id' AS "fileId",
        f->>'name' AS "name",
        f->>'originalName' AS "originalName",
        (f->>'size')::bigint AS "size",
        f->>'mimeType' AS "mimeType",
        f->>'uploadedAt' AS "uploadedAt",
        f->>'uploadedBy' AS "uploadedBy",
        t.id AS "taskId",
        t.title AS "taskTitle",
        p.id AS "projectId",
        p.name AS "projectName",
        p.color AS "projectColor",
        u.name AS "uploaderName",
        f->>'storageKey' AS "storageKey"
      FROM tasks t
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.files, '[]'::jsonb)) AS f
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = (f->>'uploadedBy')::uuid
      ${whereFragment}
      ORDER BY (f->>'uploadedAt')::timestamptz DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS "total"
      FROM tasks t
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.files, '[]'::jsonb)) AS f
      ${whereFragment}
    `),
  ]);

  return {
    data: dataResult as unknown as FileEntry[],
    total: Number((countResult as any)[0]?.total ?? 0),
    page,
    limit,
  };
}

export async function purgeFilesBefore(before: Date): Promise<{ deleted: number }> {
  const beforeIso = before.toISOString();

  // Get all tasks with files that have old entries
  const tasksWithFiles = await db.execute<{
    id: string;
    files: string;
  }>(sql`
    SELECT t.id, t.files::text AS "files"
    FROM ${tasks} t
    WHERE jsonb_array_length(COALESCE(t.files, '[]'::jsonb)) > 0
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.files) AS f
        WHERE (f->>'uploadedAt')::timestamptz < ${beforeIso}::timestamptz
      )
  `);

  let deleted = 0;

  for (const row of tasksWithFiles) {
    const allFiles: any[] = JSON.parse(row.files);
    const toDelete = allFiles.filter(f => new Date(f.uploadedAt) < before);
    const toKeep = allFiles.filter(f => new Date(f.uploadedAt) >= before);

    // Delete physical files. The metadata comes from the database: invalid
    // keys or names (e.g. `../`) are skipped, never resolved on disk.
    for (const file of toDelete) {
      if (file.storageKey) {
        const storagePath = isValidStorageKey(file.storageKey) ? safeUploadPath("files", file.storageKey) : null;
        if (!storagePath) {
          logger.warn("system", "File retention: skipped invalid storage key", { taskId: row.id });
          continue;
        }
        // Content-addressable: check if any other task references this storageKey
        // (excluding files we're about to remove from this task's JSONB)
        const refResult = await db.execute(sql`
          SELECT count(*)::int AS count FROM tasks
          WHERE id != ${row.id}
          AND files::text LIKE ${'%' + file.storageKey + '%'}
        `);
        const refCount = Number((refResult as any)[0]?.count ?? 0);
        if (refCount === 0) {
          try { await unlink(storagePath); } catch {}
        }
      } else {
        // Legacy: delete from task-specific folder (single file name, no path)
        const filePath = typeof file.name === "string" && basename(file.name) === file.name
          ? safeUploadPath("tasks", row.id, file.name)
          : null;
        if (!filePath) {
          logger.warn("system", "File retention: skipped invalid legacy file name", { taskId: row.id });
          continue;
        }
        try { await unlink(filePath); } catch {}
      }
    }

    // Update task JSONB
    await db.update(tasks)
      .set({ files: toKeep as any })
      .where(eq(tasks.id, row.id));

    deleted += toDelete.length;
  }

  return { deleted };
}

// Throttle: max once per hour
let lastRetentionRun = 0;

export async function applyFileRetentionPolicy() {
  const now = Date.now();
  if (now - lastRetentionRun < 3600_000) return;
  lastRetentionRun = now;

  const days = await getConfigValue("FILE_RETENTION");
  const daysNum = parseInt(days ?? "0", 10);
  if (!daysNum || daysNum <= 0) return;

  const before = new Date(now - daysNum * 86400_000);
  await purgeFilesBefore(before);
}
