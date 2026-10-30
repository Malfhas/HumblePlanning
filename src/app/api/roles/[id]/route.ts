import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getRoleById, updateRole, deleteRole } from "@/lib/services/role-service";
import { updateRoleSchema } from "@/lib/validators/role";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:roles");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const role = await getRoleById(id);
    if (!role) return apiError("roles.errors.notFound");
    return apiSuccess(role);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "roles:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateRoleSchema);
    const role = await updateRole(id, data);
    return apiSuccess(role);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "roles:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const role = await deleteRole(id);
    return apiSuccess(role);
  } catch (error) {
    // Role still has users attached: RoleHasUsersError (AppError, 409) carries
    // `details.users` so the UI can prompt the admin to reassign them.
    return handleApiError(error);
  }
}
