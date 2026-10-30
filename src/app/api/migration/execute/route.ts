import { requireAuth, requirePermission, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { executeMigration } from "@/lib/services/migration-service";
import { logAudit } from "@/lib/services/audit-service";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:create");

    const result = await executeMigration(session.user.id);

    logAudit({
      userId: session.user.id,
      action: "migrate",
      entityType: "system",
      metadata: { source: "soplanning", version: result.version, success: result.success },
    }).catch(() => {});

    return apiSuccess(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("migration", `Migration failed: ${message}`);
    // Uncoded error (SQL transaction…): technical detail kept as a parameter.
    return handleApiError(error instanceof AppError ? error : new AppError("settings.errors.migrationFailed", { status: 500, params: { detail: message } }));
  }
}
