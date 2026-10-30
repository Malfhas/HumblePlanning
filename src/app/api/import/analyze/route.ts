import { requireAuth, requirePermission, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import {
  analyzeImportFromDisk,
  ensureImportDirExported,
  getImportDumpPath,
} from "@/lib/services/import-service";
import { logger } from "@/lib/logger";
import { createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { refuseInDemo } from "@/lib/demo/guard";

// Node.js Route Handler (not Edge) — required for streams + fs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_MB = 500;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export async function POST(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  const dumpPath = getImportDumpPath();

  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:create");

    // Content-Length pre-check if the client sends it (fast rejection without writing).
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 0 && contentLength > MAX_UPLOAD_BYTES) {
      throw new AppError("settings.errors.fileTooLargeMb", { status: 413, params: { max: MAX_UPLOAD_MB } });
    }

    if (!request.body) {
      throw new AppError("settings.errors.importEmptyBody");
    }

    // Direct streaming body → file on disk via a manual reader.
    // Avoids loading the dump in memory and works around the truncation
    // issues encountered with pipeline(Readable.fromWeb) and
    // request.arrayBuffer() / request.formData() in Next.js 16.
    ensureImportDirExported();
    const fileStream = createWriteStream(dumpPath);
    const reader = request.body.getReader();
    let totalWritten = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!fileStream.write(value)) {
            await new Promise<void>((res) => fileStream.once("drain", () => res()));
          }
          totalWritten += value.byteLength;
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
    }
    logger.info("import", `Stream finished: ${totalWritten} bytes written`);

    const stats = await stat(dumpPath);
    logger.info("import", `Dump received: ${stats.size} bytes (Content-Length: ${contentLength})`);
    if (stats.size === 0) {
      await unlink(dumpPath).catch(() => {});
      throw new AppError("settings.errors.importEmptyFile");
    }
    if (stats.size > MAX_UPLOAD_BYTES) {
      await unlink(dumpPath).catch(() => {});
      throw new AppError("settings.errors.fileTooLargeMb", { status: 413, params: { max: MAX_UPLOAD_MB } });
    }
    if (contentLength > 0 && stats.size !== contentLength) {
      logger.warn("import", `TRUNCATION detected: expected ${contentLength}, received ${stats.size}`);
    }

    const analysis = await analyzeImportFromDisk();
    return apiSuccess(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("import", `Analysis failed: ${message}`);
    // Uncoded error (pg_restore, disk…): technical detail kept as a parameter.
    return handleApiError(error instanceof AppError ? error : new AppError("settings.errors.importFailed", { status: 500, params: { detail: message } }));
  }
}
