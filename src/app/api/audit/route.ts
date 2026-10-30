import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { getAuditLogs } from "@/lib/services/audit-service";
import { auditFiltersSchema } from "@/lib/validators/audit";
import { getConfigValue } from "@/lib/services/config-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const moduleEnabled = await getConfigValue("MODULE_AUDIT");
    if (moduleEnabled === "false") return apiError("admin.audit.errors.moduleDisabled", 403);
    await requirePermission(session.user.id, "pages:audit");

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const filters = auditFiltersSchema.parse(params);
    const result = await getAuditLogs(filters);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
