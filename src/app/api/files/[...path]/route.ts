import { NextRequest } from "next/server";
import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { requireAuth, handleApiError, ApiError, assertUuid } from "@/lib/utils/api";
import { loadUserPermissions, hasPermission, assertTaskReadable } from "@/lib/services/permission-service";
import { isValidStorageKey, safeUploadPath } from "@/lib/utils/upload-paths";
import { contentDisposition } from "@/lib/utils/file-response";
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

/**
 * Task attachment: `/api/files/tasks/{taskId}/{fileName}`, the only URL the UI
 * builds (avatars and branding have their own routes). The task must be in
 * the user's read scope and the file listed in its metadata.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const session = await requireAuth();
    // Allow access with either files:view (task attachments) or pages:files (files page)
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "files:view") && !hasPermission(perms, "pages:files")) {
      throw new ApiError("errors.forbidden");
    }
    const { path: pathSegments } = await params;
    if (pathSegments[0] !== "tasks" || pathSegments.length < 3) {
      throw new ApiError("admin.files.errors.notFound");
    }
    const taskId = pathSegments[1];
    const fileName = pathSegments.slice(2).join("/");
    assertUuid(taskId);
    await assertTaskReadable(perms, taskId);

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: { files: true },
    });
    const files = (task?.files ?? []) as { name?: string; originalName?: string; storageKey?: string }[];
    const fileEntry = files.find(f => f.name === fileName);
    if (!fileEntry) throw new ApiError("admin.files.errors.notFound");

    // Content-addressable path, or legacy per-task folder (backwards compat).
    // Database values only reach the filesystem once confined to their area.
    const resolvedPath = fileEntry.storageKey
      ? (isValidStorageKey(fileEntry.storageKey) ? safeUploadPath("files", fileEntry.storageKey) : null)
      : safeUploadPath(`tasks/${taskId}`, fileName);
    if (!resolvedPath) throw new ApiError("admin.files.errors.notFound");

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(resolvedPath);
    } catch {
      throw new ApiError("admin.files.errors.notFound");
    }
    const contentType = getMimeType(extname(resolvedPath));

    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": contentType,
        // Access-controlled content: never stored by the browser or a shared cache.
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(contentType, fileEntry.originalName || fileName),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
