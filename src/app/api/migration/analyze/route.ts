import { requireAuth, requirePermission, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { analyzeMigration } from "@/lib/services/migration-service";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:create");

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new AppError("errors.noFile");

    if (file.size > 500 * 1024 * 1024) {
      throw new AppError("settings.errors.fileTooLargeMb", { params: { max: 500 } });
    }

    if (!file.name.endsWith(".zip")) {
      throw new AppError("settings.errors.migrationZipRequired");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const analysis = await analyzeMigration(buffer);
    return apiSuccess(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("migration", `Analysis failed: ${message}`);
    // Uncoded error (unreadable archive, CSV…): technical detail kept as a parameter.
    return handleApiError(error instanceof AppError ? error : new AppError("settings.errors.migrationFailed", { status: 500, params: { detail: message } }));
  }
}
