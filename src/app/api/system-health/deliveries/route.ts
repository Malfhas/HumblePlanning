import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getFailedDeliveries } from "@/lib/services/system-health-service";
import { deliveriesQuerySchema, parseQuery } from "@/lib/validators/system-health";
import { periodSince } from "@/lib/system-health/retention";

/** System health: failed e-mails, SMS and webhooks over the period. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:system_health");
    const { days } = parseQuery(deliveriesQuerySchema, request.nextUrl.searchParams);
    return apiSuccess(await getFailedDeliveries(periodSince(new Date(), days)));
  } catch (error) {
    return handleApiError(error);
  }
}
