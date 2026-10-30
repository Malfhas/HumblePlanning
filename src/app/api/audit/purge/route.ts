import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { purgeAuditLogs } from "@/lib/services/audit-service";
import { auditPurgeSchema } from "@/lib/validators/audit";
import { getConfigValue } from "@/lib/services/config-service";

export async function DELETE(request: Request) {
  try {
    const session = await requireAuth();
    const moduleEnabled = await getConfigValue("MODULE_AUDIT");
    if (moduleEnabled === "false") return apiError("admin.audit.errors.moduleDisabled", 403);
    await requirePermission(session.user.id, "audit:purge");

    const data = await validateBody(request, auditPurgeSchema);
    const count = await purgeAuditLogs(new Date(data.before));
    return apiSuccess({ purged: count });
  } catch (error) {
    return handleApiError(error);
  }
}
