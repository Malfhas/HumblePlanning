import { NextRequest } from "next/server";
import { join, resolve, extname } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { requireAuth, requirePermission, handleApiError, ApiError } from "@/lib/utils/api";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
  };
  return mimeMap[ext.toLowerCase()] || "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const session = await requireAuth();
    // Allow access with either files:view (task attachments) or pages:files (files page)
    const { loadUserPermissions, hasPermission } = await import("@/lib/services/permission-service");
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "files:view") && !hasPermission(perms, "pages:files")) {
      throw new ApiError("errors.forbidden");
    }
    const { path: pathSegments } = await params;
    const uploadsDir = join(process.cwd(), "uploads");

    let resolvedPath: string;

    // Check if this is a task file request (path: tasks/{taskId}/{fileName})
    if (pathSegments[0] === "tasks" && pathSegments.length >= 3) {
      const taskId = pathSegments[1];
      const fileName = pathSegments.slice(2).join("/");

      // Look up the task's files JSONB for a storageKey
      const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { files: true },
      });
      const files = (task?.files ?? []) as { name?: string; storageKey?: string }[];
      const fileEntry = files.find(f => f.name === fileName);

      if (fileEntry?.storageKey) {
        // Content-addressable path
        resolvedPath = join(uploadsDir, "files", fileEntry.storageKey);
      } else {
        // Legacy path (backwards compat)
        resolvedPath = resolve(uploadsDir, ...pathSegments);
      }
    } else {
      resolvedPath = resolve(uploadsDir, ...pathSegments);
    }

    // Security: ensure path is within uploads directory (prevent path traversal)
    if (!resolvedPath.startsWith(uploadsDir)) {
      throw new ApiError("errors.forbidden");
    }

    // Check file exists
    try {
      await stat(resolvedPath);
    } catch {
      throw new ApiError("admin.files.errors.notFound");
    }

    const fileBuffer = await readFile(resolvedPath);
    const ext = extname(resolvedPath);

    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": getMimeType(ext),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
