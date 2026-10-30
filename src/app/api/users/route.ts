import { NextRequest } from "next/server";
import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { getUsers, createUser } from "@/lib/services/user-service";
import { createUserSchema } from "@/lib/validators/user";
import { loadUserPermissions, getVisibleUserIds, hasPermission } from "@/lib/services/permission-service";

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
    const unscoped =
      request.nextUrl.searchParams.get("unscoped") === "true" &&
      (hasPermission(perms, "pages:users") ||
        hasPermission(perms, "pages:projects") ||
        hasPermission(perms, "pages:stats_users") ||
        hasPermission(perms, "pages:stats_projects") ||
        hasPermission(perms, "pages:stats_roi"));
    let users = await getUsers(search, activeOnly, planningOnly);

    // Apply permission-based visibility filtering (unless explicitly bypassed)
    if (!unscoped) {
      const visibleIds = await getVisibleUserIds(perms);
      if (visibleIds) {
        const visibleSet = new Set(visibleIds);
        users = users.filter((u: { id: string }) => visibleSet.has(u.id));
      }
    }

    // Strip sensitive fields (email, mobile, phone) for users without users:edit permission
    if (!hasPermission(perms, "users:edit")) {
      users = users.map((u: any) => {
        // Self: keep all fields
        if (u.id === session.user.id) return u;
        const { email, mobile, phone, ...safeUser } = u;
        return safeUser;
      });
    }

    return apiSuccess(users);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "users:create");
    const data = await validateBody(request, createUserSchema);
    const user = await createUser(data, session.user.id);
    return apiSuccess(user, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
