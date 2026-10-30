import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { executeImport } from "@/lib/services/import-service";
import { logAudit } from "@/lib/services/audit-service";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { refuseInDemo } from "@/lib/demo/guard";

const executeSchema = z.object({
  mode: z.enum(["merge", "replace"]),
});

export async function POST(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:create");

    const { mode } = await validateBody(request, executeSchema);
    const result = await executeImport(mode, session.user.id);

    logAudit({
      userId: session.user.id,
      action: "restore",
      entityType: "system",
      metadata: { mode, success: result.success },
    }).catch(() => {});

    return apiSuccess(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("import", `Import failed: ${message}`);
    // Uncoded error (pg_restore, SQL…): technical detail kept as a parameter.
    return handleApiError(error instanceof AppError ? error : new AppError("settings.errors.importFailed", { status: 500, params: { detail: message } }));
  }
}
