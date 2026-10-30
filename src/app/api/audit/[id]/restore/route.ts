import { requireAuth, requirePermission, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { getAuditLogById, restoreFromAudit } from "@/lib/services/audit-service";
import { emitTaskEvent } from "@/lib/socket-events";
import { getConfigValue } from "@/lib/services/config-service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const moduleEnabled = await getConfigValue("MODULE_AUDIT");
    if (moduleEnabled === "false") return apiError("admin.audit.errors.moduleDisabled", 403);
    await requirePermission(session.user.id, "audit:restore");
    const { id } = await params;

    const log = await getAuditLogById(id);
    if (!log) return apiError("admin.audit.errors.notFound");

    const result = await restoreFromAudit(id, session.user.id);

    if (result.entityType === "task" && result.entityId) {
      emitTaskEvent({ action: "updated", taskId: result.entityId, userId: session.user.id });
    }

    return apiSuccess({ restored: true, log: result });
  } catch (error) {
    return handleApiError(error);
  }
}
