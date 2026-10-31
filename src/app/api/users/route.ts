import { NextRequest } from "next/server";
import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { getUsers, createUser, withoutContactFields } from "@/lib/services/user-service";
import { createUserSchema } from "@/lib/validators/user";
import { loadUserPermissions, getVisibleUserIds, getVisibleBusinessUnitIds, hasPermission } from "@/lib/services/permission-service";
import { assertCanManageUser, userReadFilter } from "@/lib/services/user-access";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);

    // Page gate: pages:users OR pages:planning OR pages:home OR pages:projects
    if (
      !hasPermission(perms, "pages:users") &&
      !hasPermission(perms, "pages:planning") &&
      !hasPermission(perms, "pages:home") &&
      !hasPermission(perms, "pages:projects")
    ) {
      return apiError("errors.forbidden");
    }

    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    const activeOnly = request.nextUrl.searchParams.get("active") !== "false";
    const planningOnly = request.nextUrl.searchParams.get("planning") === "true";
    // Bypass userScope filtering. Honored if the caller has pages:users
    // (/users management), pages:projects (project-form owner picker), or
    // any stats page (filter bars need the full user list for selection).
    // The list then stays within the business-unit scope (scope:bu_*).
    const unscoped =
      request.nextUrl.searchParams.get("unscoped") === "true" &&
      (hasPermission(perms, "pages:users") ||
        hasPermission(perms, "pages:projects") ||
        hasPermission(perms, "pages:stats_users") ||
        hasPermission(perms, "pages:stats_projects") ||
        hasPermission(perms, "pages:stats_roi"));
    let users = await getUsers(search, activeOnly, planningOnly);

    // Permission-based visibility, extended to the business units in scope when bypassed
    const readable = userReadFilter(
      await getVisibleUserIds(perms),
      unscoped ? getVisibleBusinessUnitIds(perms) : [],
    );
    if (readable) users = users.filter(readable);

    // Strip contact fields (email, phone, mobile, address) for users without users:edit permission
    if (!hasPermission(perms, "users:edit")) {
      // Self: keep all fields
      users = users.map((u: { id: string }) => (u.id === session.user.id ? u : withoutContactFields(u)));
    }

    return apiSuccess(users);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "users:create");
    const data = await validateBody(request, createUserSchema);
    // Role and business unit within the creator's own rights
    await assertCanManageUser(perms, { roleId: data.roleId, businessUnitId: data.businessUnitId ?? null });
    const user = await createUser(data, session.user.id);
    return apiSuccess(user, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
