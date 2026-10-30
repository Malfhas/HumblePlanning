import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getBusinessUnitById, updateBusinessUnit, deleteBusinessUnit } from "@/lib/services/business-unit-service";
import { updateBusinessUnitSchema } from "@/lib/validators/business-unit";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    // Auth-only: BU details (name, number, address) are displayed across the app.
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const bu = await getBusinessUnitById(id);
    if (!bu) return apiError("users.errors.businessUnitNotFound", 404);
    return apiSuccess(bu);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "business_units:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateBusinessUnitSchema);
    const bu = await updateBusinessUnit(id, data, session.user.id);
    if (!bu) return apiError("users.errors.businessUnitNotFound", 404);
    return apiSuccess(bu);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "business_units:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const bu = await deleteBusinessUnit(id, session.user.id);
    if (!bu) return apiError("users.errors.businessUnitNotFound", 404);
    return apiSuccess(bu);
  } catch (error) {
    return handleApiError(error);
  }
}
