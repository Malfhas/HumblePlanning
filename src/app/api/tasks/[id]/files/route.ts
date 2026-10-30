import { NextRequest } from "next/server";
import { requireAuth, handleApiError, AppError, apiSuccess, assertUuid } from "@/lib/utils/api";
import { loadUserPermissions, hasPermission, canModifyTask } from "@/lib/services/permission-service";
import { getTaskById } from "@/lib/services/task-service";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getConfigValues } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { applyFileRetentionPolicy } from "@/lib/services/file-service";
import { notifyTaskFileEvent } from "@/lib/services/notification-service";
import { emitTaskEvent } from "@/lib/socket-events";
import { schedulePushTaskFileEvent } from "@/lib/services/push-notification-queue";
import { taskUsers } from "@/db/schema";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { logger } from "@/lib/logger";

interface FileMetadata {
  id: string;
  name: string;
  originalName: string;
  storageKey?: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy?: string;
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return mimeMap[ext] || "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "files:view") && !hasPermission(perms, "pages:files")) {
      throw new AppError("errors.forbidden");
    }
    const { id } = await params;
    assertUuid(id);

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
      columns: { files: true },
    });

    if (!task) throw new AppError("tasks.errors.notFound");
    return apiSuccess(task.files ?? []);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "files:upload")) {
      throw new AppError("tasks.errors.addFilesForbidden", { status: 403 });
    }
    const existingTask = await getTaskById(id);
    if (!existingTask) throw new AppError("tasks.errors.notFound");
    if (!canModifyTask(perms, {
      users: existingTask.users,
      creatorId: existingTask.creatorId,
      projectOwnerId: existingTask.project?.ownerId,
    })) {
      throw new AppError("tasks.errors.notAllowed");
    }

    // Get config
    const config = await getConfigValues(["ENABLE_FILE_UPLOAD", "WHITELIST_UPLOAD", "MAX_UPLOAD_SIZE_MB", "MAX_TOTAL_SIZE_MB", "MAX_FILES_PER_TASK"]);
    if (config.ENABLE_FILE_UPLOAD === "false") {
      throw new AppError("tasks.errors.filesDisabled", { status: 403 });
    }
    const allowedExtensions = (config.WHITELIST_UPLOAD || "pdf,png,jpg,jpeg,gif,webp").split(",").map(e => e.trim().toLowerCase());
    const maxSizeMB = parseInt(config.MAX_UPLOAD_SIZE_MB || "10", 10);
    const maxTotalSizeMB = parseInt(config.MAX_TOTAL_SIZE_MB || "25", 10);
    const maxFiles = parseInt(config.MAX_FILES_PER_TASK || "5", 10);

    // Get current task + assigned users
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
      columns: { id: true, title: true, files: true, projectId: true, startDate: true },
    });
    if (!task) throw new AppError("tasks.errors.notFound");

    const assignedRows = await db.select({ userId: taskUsers.userId })
      .from(taskUsers)
      .where(eq(taskUsers.taskId, id));
    const assignedUserIds = assignedRows.map((r) => r.userId);

    const currentFiles: FileMetadata[] = (task.files as FileMetadata[] | null) ?? [];
    if (currentFiles.length >= maxFiles) {
      throw new AppError("tasks.errors.maxFilesReached", { params: { max: maxFiles } });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new AppError("errors.noFile");

    // Validate extension
    const ext = getExtension(file.name);
    if (!allowedExtensions.includes(ext)) {
      throw new AppError("tasks.errors.extensionNotAllowed", { params: { ext, allowed: allowedExtensions.join(", ") } });
    }

    // Validate individual file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      throw new AppError("tasks.errors.fileTooLarge", { params: { max: maxSizeMB } });
    }

    // Validate total size across all files
    const currentTotalSize = currentFiles.reduce((sum, f) => sum + f.size, 0);
    if (currentTotalSize + file.size > maxTotalSizeMB * 1024 * 1024) {
      throw new AppError("tasks.errors.totalSizeExceeded", { params: { max: maxTotalSizeMB } });
    }

    const fileId = crypto.randomUUID();

    let finalName: string;
    let finalSize: number;
    let finalMimeType: string;
    let storageKey: string;

    const buffer = Buffer.from(await file.arrayBuffer());

    if (IMAGE_EXTENSIONS.includes(ext)) {
      // Compress image to WebP
      const processed = await sharp(buffer)
        .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const contentHash = createHash("sha256").update(processed).digest("hex");
      storageKey = `${contentHash}.webp`;
      finalName = `${fileId}.webp`;
      finalSize = processed.length;
      finalMimeType = "image/webp";

      // Save to content-addressable storage
      const storageDir = join(process.cwd(), "uploads", "files");
      await mkdir(storageDir, { recursive: true });
      const storagePath = join(storageDir, storageKey);
      try {
        await access(storagePath); // File already exists, skip write
      } catch {
        await writeFile(storagePath, processed); // New file, write it
      }
    } else {
      // Store as-is
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      storageKey = `${contentHash}.${ext}`;
      finalName = `${fileId}_${file.name}`;
      finalSize = buffer.length;
      finalMimeType = getMimeType(ext);

      // Save to content-addressable storage
      const storageDir = join(process.cwd(), "uploads", "files");
      await mkdir(storageDir, { recursive: true });
      const storagePath = join(storageDir, storageKey);
      try {
        await access(storagePath); // File already exists, skip write
      } catch {
        await writeFile(storagePath, buffer); // New file, write it
      }
    }

    const metadata: FileMetadata = {
      id: fileId,
      name: finalName,
      originalName: file.name,
      storageKey,
      size: finalSize,
      mimeType: finalMimeType,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session.user.id,
    };

    const updatedFiles = [...currentFiles, metadata];

    await db.update(tasks)
      .set({ files: updatedFiles as any })
      .where(eq(tasks.id, id));

    // Real-time update for files page
    await emitTaskEvent({ action: "updated", taskId: id, userId: session.user.id });

    // Audit
    logAudit({
      userId: session.user.id,
      action: "file_upload",
      entityType: "task",
      entityId: id,
      newValues: { fileName: metadata.originalName, fileSize: metadata.size, mimeType: metadata.mimeType },
      metadata: { title: task.title, projectId: task.projectId, userIds: assignedUserIds },
    }).catch(() => {});

    // Auto-purge based on retention policy
    applyFileRetentionPolicy().catch(() => {});

    // Notify task users about file upload
    try {
      if (assignedUserIds.length > 0) {
        await notifyTaskFileEvent(
          { id, title: task.title ?? "", startDate: task.startDate ?? "", projectId: task.projectId },
          "task_file_added",
          metadata.originalName,
          assignedUserIds,
          session.user.id
        );
        schedulePushTaskFileEvent(
          { id, title: task.title ?? "", startDate: task.startDate ?? "", projectId: task.projectId },
          "task_file_added",
          metadata.originalName,
          assignedUserIds,
          session.user.id
        );
      }
    } catch (err) {
      logger.error("api", "File upload notification error", { error: err instanceof Error ? err.message : String(err) });
    }

    return apiSuccess(metadata, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    assertUuid(id);
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "files:delete")) {
      throw new AppError("tasks.errors.deleteFilesForbidden", { status: 403 });
    }
    const existingTask = await getTaskById(id);
    if (!existingTask) throw new AppError("tasks.errors.notFound");
    if (!canModifyTask(perms, {
      users: existingTask.users,
      creatorId: existingTask.creatorId,
      projectOwnerId: existingTask.project?.ownerId,
    })) {
      throw new AppError("tasks.errors.notAllowed");
    }

    const enableConfig = await getConfigValues(["ENABLE_FILE_UPLOAD"]);
    if (enableConfig.ENABLE_FILE_UPLOAD === "false") {
      throw new AppError("tasks.errors.filesDisabled", { status: 403 });
    }

    const fileId = request.nextUrl.searchParams.get("fileId");
    if (!fileId) throw new AppError("tasks.errors.fileIdRequired");

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
      columns: { id: true, title: true, files: true, projectId: true, startDate: true },
    });
    if (!task) throw new AppError("tasks.errors.notFound");

    const assignedRows = await db.select({ userId: taskUsers.userId })
      .from(taskUsers)
      .where(eq(taskUsers.taskId, id));
    const assignedUserIds = assignedRows.map((r) => r.userId);

    const currentFiles: FileMetadata[] = (task.files as FileMetadata[] | null) ?? [];
    const fileToDelete = currentFiles.find(f => f.id === fileId);
    if (!fileToDelete) throw new AppError("tasks.errors.fileNotFound", { status: 404 });

    // Delete from filesystem
    const storageKey = fileToDelete.storageKey;
    if (storageKey) {
      // Content-addressable: check if any other task references this storageKey
      const refResult = await db.execute(sql`
        SELECT count(*)::int AS count FROM tasks
        WHERE id != ${id}
        AND files::text LIKE ${'%' + storageKey + '%'}
      `);
      const refCount = Number((refResult as any)[0]?.count ?? 0);
      if (refCount === 0) {
        // No other task uses this file, safe to delete from disk
        const storagePath = join(process.cwd(), "uploads", "files", storageKey);
        try { await unlink(storagePath); } catch {}
      }
      // If refCount > 0, just remove from JSONB but keep file on disk
    } else {
      // Legacy: delete from task-specific folder
      const filePath = join(process.cwd(), "uploads", "tasks", id, fileToDelete.name);
      try { await unlink(filePath); } catch {}
    }

    // Update task
    const updatedFiles = currentFiles.filter(f => f.id !== fileId);
    await db.update(tasks)
      .set({ files: updatedFiles as any })
      .where(eq(tasks.id, id));

    // Real-time update for files page
    await emitTaskEvent({ action: "updated", taskId: id, userId: session.user.id });

    // Audit
    logAudit({
      userId: session.user.id,
      action: "file_delete",
      entityType: "task",
      entityId: id,
      oldValues: { fileName: fileToDelete.originalName, fileSize: fileToDelete.size, mimeType: fileToDelete.mimeType },
      metadata: { title: task.title, projectId: task.projectId, userIds: assignedUserIds },
    }).catch(() => {});

    // Notify task users about file deletion
    try {
      if (assignedUserIds.length > 0) {
        await notifyTaskFileEvent(
          { id, title: task.title ?? "", startDate: task.startDate ?? "", projectId: task.projectId },
          "task_file_deleted",
          fileToDelete.originalName,
          assignedUserIds,
          session.user.id
        );
        schedulePushTaskFileEvent(
          { id, title: task.title ?? "", startDate: task.startDate ?? "", projectId: task.projectId },
          "task_file_deleted",
          fileToDelete.originalName,
          assignedUserIds,
          session.user.id
        );
      }
    } catch (err) {
      logger.error("api", "File delete notification error", { error: err instanceof Error ? err.message : String(err) });
    }

    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
