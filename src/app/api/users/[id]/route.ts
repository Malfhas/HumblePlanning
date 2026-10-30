import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getUserById, updateUser, deleteUser, archiveUser } from "@/lib/services/user-service";
import { loadUserPermissions, hasPermission, getVisibleUserIds } from "@/lib/services/permission-service";
import { updateUserSchema } from "@/lib/validators/user";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    // Self-access: any authenticated user can read their own profile (needed by
    // usePermissions hook to load teamId, roleId, businessUnitId). Viewing
    // another user's profile requires pages:users or pages:planning or pages:home.
    if (id !== session.user.id) {
      const perms = await loadUserPermissions(session.user.id);
      if (!hasPermission(perms, "pages:users") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
        return apiError("errors.forbidden");
      }
      // Bypass userScope when the caller has pages:users (/users management page
      // or user-form duplicate/edit flows). Matches the list endpoint behavior.
      const url = new URL(request.url);
      const unscoped =
        url.searchParams.get("unscoped") === "true" &&
        (hasPermission(perms, "pages:users") || hasPermission(perms, "pages:projects"));
      if (!unscoped) {
        const visibleIds = await getVisibleUserIds(perms);
        if (visibleIds && !visibleIds.includes(id)) {
          return apiError("errors.forbidden");
        }
      }
    }
    const user = await getUserById(id);
    if (!user) return apiError("users.errors.notFound");
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "users:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateUserSchema);

    const user = await updateUser(id, data, session.user.id);
    if (!user) return apiError("users.errors.notFound");
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "users:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const body = await request.json();
    const active = typeof body.active === "boolean" ? body.active : undefined;
    if (active === undefined) return apiError("users.errors.activeRequired");
    const user = await archiveUser(id, active, session.user.id);
    if (!user) return apiError("users.errors.notFound");
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "users:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const user = await deleteUser(id, session.user.id);
    if (!user) return apiError("users.errors.notFound");
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}
