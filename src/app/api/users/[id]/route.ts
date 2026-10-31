import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getUserById, updateUser, deleteUser, archiveUser, withoutContactFields } from "@/lib/services/user-service";
import { loadUserPermissions, hasPermission, getVisibleUserIds, getVisibleBusinessUnitIds } from "@/lib/services/permission-service";
import { assertCanManageUser, userReadFilter } from "@/lib/services/user-access";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { updateUserSchema } from "@/lib/validators/user";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    // Self-access: any authenticated user can read their own profile (needed by
    // usePermissions hook to load teamId, roleId, businessUnitId). Viewing
    // another user's profile requires pages:users or pages:planning or pages:home.
    let hideContact = false;
    if (id !== session.user.id) {
      const perms = await loadUserPermissions(session.user.id);
      // Same masking as the list (GET /api/users)
      hideContact = !hasPermission(perms, "users:edit");
      if (!hasPermission(perms, "pages:users") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
        return apiError("errors.forbidden");
      }
      // Bypass userScope when the caller has pages:users (/users management page
      // or user-form duplicate/edit flows), within the business-unit scope.
      // Matches the list endpoint behavior.
      const url = new URL(request.url);
      const unscoped =
        url.searchParams.get("unscoped") === "true" &&
        (hasPermission(perms, "pages:users") || hasPermission(perms, "pages:projects"));
      const readable = userReadFilter(
        await getVisibleUserIds(perms),
        unscoped ? getVisibleBusinessUnitIds(perms) : [],
      );
      // Outside the planning visibility: the user's business unit decides
      if (readable && !readable({ id })) {
        // Unknown and out-of-scope users get the same answer
        const target = await db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, businessUnitId: true } });
        if (!target || !readable(target)) return apiError("errors.forbidden");
      }
    }
    const user = await getUserById(id);
    if (!user) return apiError("users.errors.notFound");
    return apiSuccess(hideContact ? withoutContactFields(user) : user);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "users:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateUserSchema);
    // Target account, requested role and business unit within the editor's rights
    await assertCanManageUser(perms, { targetId: id, roleId: data.roleId, businessUnitId: data.businessUnitId });

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
    const perms = await requirePermission(session.user.id, "users:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const body = await request.json();
    const active = typeof body.active === "boolean" ? body.active : undefined;
    if (active === undefined) return apiError("users.errors.activeRequired");
    await assertCanManageUser(perms, { targetId: id });
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
    const perms = await requirePermission(session.user.id, "users:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await assertCanManageUser(perms, { targetId: id });
    const user = await deleteUser(id, session.user.id);
    if (!user) return apiError("users.errors.notFound");
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}
