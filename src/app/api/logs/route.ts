import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { logger, type LogLevel, type LogCategory } from "@/lib/logger";
import { getConfigValue } from "@/lib/services/config-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const moduleEnabled = await getConfigValue("MODULE_AUDIT");
    if (moduleEnabled === "false") return apiError("admin.audit.errors.moduleDisabled", 403);
    await requirePermission(session.user.id, "pages:audit");

    const params = request.nextUrl.searchParams;
    const level = params.get("level") as LogLevel | null;
    const category = params.get("category") as LogCategory | null;
    const search = params.get("search") || undefined;
    const limit = parseInt(params.get("limit") || "200") || 200;

    const entries = logger.getEntries({
      level: level || undefined,
      category: category || undefined,
      search,
      limit,
    });

    return apiSuccess({ data: entries, total: logger.size });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const session = await requireAuth();
    const moduleAudit = await getConfigValue("MODULE_AUDIT");
    if (moduleAudit === "false") return apiError("admin.audit.errors.moduleDisabled", 403);
    await requirePermission(session.user.id, "audit:purge");
    logger.clear();
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
