import { NextRequest } from "next/server";
import { AppError, apiSuccessCompressed, handleApiError, requireAuth } from "@/lib/utils/api";
import { getTaskAccessScope, hasPermission, loadUserPermissions } from "@/lib/services/permission-service";
import { getTasks } from "@/lib/services/task-service";
import { taskFiltersSchema } from "@/lib/validators/task";
import { mobileTaskSyncSchema } from "@/lib/validators/mobile";

/**
 * GET /api/mobile/tasks/sync?startDate&endDate[&since][&businessUnitIds]: tasks
 * of a date range for the app's cache, in the read scope of `/api/tasks`.
 * `changed` holds the tasks modified since `since` (all of them without it),
 * `ids` every task of the range: an id missing from it was deleted or left the
 * range or the user's scope. The next call passes the returned `serverTime`.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "pages:tasks") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
      throw new AppError("errors.forbidden");
    }

    const parsed = mobileTaskSyncSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError("errors.invalidData", { status: 422, details: parsed.error.issues });
    const { startDate, endDate, since, businessUnitIds } = parsed.data;

    // Read before the query: a task changed meanwhile comes back on the next sync
    const serverTime = new Date();
    const filters = taskFiltersSchema.parse({ startDate, endDate, businessUnitIds, unpaginated: "true" });
    const { data } = await getTasks(filters, await getTaskAccessScope(perms));

    const sinceTime = since ? new Date(since).getTime() : null;
    const changed = sinceTime === null
      ? data
      : data.filter((task) => new Date(task.updatedAt).getTime() >= sinceTime);

    return apiSuccessCompressed({
      serverTime: serverTime.toISOString(),
      changed,
      ids: data.map((task) => task.id),
    }, request);
  } catch (error) {
    return handleApiError(error);
  }
}
