import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, apiSuccess, handleApiError, requireAuth } from "@/lib/utils/api";
import { listMobileAlerts } from "@/lib/services/mobile-alert-service";

const afterSchema = z.iso.datetime({ offset: true }).nullable();

/**
 * GET /api/mobile/alerts[?after]: alerts not delivered by push yet. The next
 * call passes the returned `serverTime`; the app ignores the ids it already showed.
 * A full page returns the date of its last alert instead, so the next call reads on.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const parsed = afterSchema.safeParse(request.nextUrl.searchParams.get("after"));
    if (!parsed.success) throw new AppError("errors.invalidData", { status: 422, details: parsed.error.issues });
    const now = new Date();
    const after = parsed.data ? new Date(parsed.data) : null;
    const { alerts, full } = await listMobileAlerts(session.user.id, after, now);
    const serverTime = after && full ? alerts[alerts.length - 1].createdAt : now;
    return apiSuccess({ serverTime: serverTime.toISOString(), alerts, more: after !== null && full });
  } catch (error) {
    return handleApiError(error);
  }
}
