import { requireAuth, requirePermission, handleApiError, apiSuccess } from "@/lib/utils/api";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { sql } from "drizzle-orm";
import { statfs } from "node:fs/promises";
import { join } from "node:path";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:files");

    // Count files and total size from tasks JSONB column
    const result = await db.execute<{
      totalFiles: number;
      totalSize: string;
      taskCount: number;
    }>(sql`
      SELECT
        COALESCE(SUM(jsonb_array_length(COALESCE(t.files, '[]'::jsonb))), 0)::int AS "totalFiles",
        COALESCE(SUM(file_sizes.total), 0)::bigint AS "totalSize",
        COUNT(CASE WHEN jsonb_array_length(COALESCE(t.files, '[]'::jsonb)) > 0 THEN 1 END)::int AS "taskCount"
      FROM ${tasks} t
      LEFT JOIN LATERAL (
        SELECT SUM((elem->>'size')::bigint) AS total
        FROM jsonb_array_elements(COALESCE(t.files, '[]'::jsonb)) AS elem
      ) file_sizes ON true
    `);

    // Storage per user
    const perUser = await db.execute<{
      userId: string;
      userName: string;
      userColor: string;
      fileCount: number;
      totalSize: string;
    }>(sql`
      SELECT
        u.id AS "userId",
        u.name AS "userName",
        u.color AS "userColor",
        COUNT(*)::int AS "fileCount",
        COALESCE(SUM((f->>'size')::bigint), 0)::bigint AS "totalSize"
      FROM ${tasks} t
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.files, '[]'::jsonb)) AS f
      LEFT JOIN users u ON u.id = (f->>'uploadedBy')::uuid
      GROUP BY u.id, u.name, u.color
      ORDER BY SUM((f->>'size')::bigint) DESC
    `);

    const row = result[0];

    // Get disk space for uploads directory
    const uploadsDir = join(process.cwd(), "uploads");
    let diskFree = 0;
    let diskTotal = 0;
    try {
      const stats = await statfs(uploadsDir);
      diskFree = Number(stats.bfree) * Number(stats.bsize);
      diskTotal = Number(stats.blocks) * Number(stats.bsize);
    } catch {
      // uploads dir may not exist yet
    }

    return apiSuccess({
      totalFiles: Number(row?.totalFiles ?? 0),
      totalSize: Number(row?.totalSize ?? 0),
      taskCount: Number(row?.taskCount ?? 0),
      diskFree,
      diskTotal,
      diskUsed: diskTotal - diskFree,
      perUser: perUser.map((u) => ({
        userId: u.userId,
        userName: u.userName ?? "Inconnu",
        userColor: u.userColor ?? "#6b7280",
        fileCount: Number(u.fileCount),
        totalSize: Number(u.totalSize),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
