import { NextRequest } from "next/server";
import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { countSystemEventsBefore, purgeSystemEventsBefore } from "@/lib/services/system-event-service";
import { getInstanceTimezone } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { purgeBeforeSchema, parseQuery } from "@/lib/validators/system-health";
import { purgeBeforeInstant } from "@/lib/system-health/retention";

async function cutoffOf(before: string): Promise<Date> {
  const cutoff = purgeBeforeInstant(before, await getInstanceTimezone());
  if (!cutoff) throw new AppError("errors.invalidData", { status: 422 });
  return cutoff;
}

/** Incidents a purge « before the » date would erase (last occurrence before that day). */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "system_health:purge");
    const { before } = parseQuery(purgeBeforeSchema, request.nextUrl.searchParams);
    return apiSuccess({ events: await countSystemEventsBefore(await cutoffOf(before)) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Erases those incidents; recorded in the audit log. */
export async function DELETE(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "system_health:purge");
    const { before } = await validateBody(request, purgeBeforeSchema);
    const events = await purgeSystemEventsBefore(await cutoffOf(before));
    await logAudit({ userId: session.user.id, action: "purge", entityType: "system_health", metadata: { count: events, before } });
    return apiSuccess({ events });
  } catch (error) {
    return handleApiError(error);
  }
}
