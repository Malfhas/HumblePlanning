import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { listSystemEvents } from "@/lib/services/system-event-service";
import { parseQuery, systemEventsQuerySchema } from "@/lib/validators/system-health";
import { periodSince } from "@/lib/system-health/retention";

/** System health: grouped incidents (warnings and errors), most recent first. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:system_health");
    const { days, levels, categories, search, page, limit } = parseQuery(systemEventsQuerySchema, request.nextUrl.searchParams);
    return apiSuccess(await listSystemEvents({ levels, categories, search, since: periodSince(new Date(), days), page, limit }));
  } catch (error) {
    return handleApiError(error);
  }
}
