import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getVehicleById, updateVehicle, deleteVehicle } from "@/lib/services/vehicle-service";
import { getVisibleBusinessUnitIds } from "@/lib/services/permission-service";
import { isEquipmentVisible, assertEquipmentWritable } from "@/lib/services/equipment-scope";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100),
  vehicleTypeId: z.string().uuid().nullable(),
  businessUnitId: z.string().uuid(),
  registrationNumber: z.string().max(50).nullable(),
  color: z.string().max(7),
  status: z.enum(["available", "maintenance", "out_of_service"]),
  comment: z.string().nullable(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "pages:vehicles");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const vehicle = await getVehicleById(id);
    // Outside the user's business units it answers like a missing one
    if (!vehicle || !isEquipmentVisible(vehicle, getVisibleBusinessUnitIds(perms))) {
      return apiError("resources.errors.vehicleNotFound", 404);
    }
    return apiSuccess(vehicle);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "vehicles:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    // 404 outside the user's business units; a move stays within them
    await assertEquipmentWritable(perms, "vehicle", id, data.businessUnitId);
    const vehicle = await updateVehicle(id, data);
    if (!vehicle) return apiError("resources.errors.vehicleNotFound", 404);
    return apiSuccess(vehicle);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "vehicles:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await assertEquipmentWritable(perms, "vehicle", id);
    const vehicle = await deleteVehicle(id);
    if (!vehicle) return apiError("resources.errors.vehicleNotFound", 404);
    return apiSuccess(vehicle);
  } catch (error) {
    return handleApiError(error);
  }
}
