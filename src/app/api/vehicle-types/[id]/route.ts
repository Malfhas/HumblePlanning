import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getVehicleTypeById, updateVehicleType, deleteVehicleType } from "@/lib/services/vehicle-type-service";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10),
  color: z.string().max(7),
  sortOrder: z.number().int(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:vehicle_types");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const vt = await getVehicleTypeById(id);
    if (!vt) return apiError("resources.errors.vehicleTypeNotFound", 404);
    return apiSuccess(vt);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicle_types:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    const vt = await updateVehicleType(id, data);
    if (!vt) return apiError("resources.errors.vehicleTypeNotFound", 404);
    return apiSuccess(vt);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicle_types:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const vt = await deleteVehicleType(id);
    if (!vt) return apiError("resources.errors.vehicleTypeNotFound", 404);
    return apiSuccess(vt);
  } catch (error) {
    return handleApiError(error);
  }
}
