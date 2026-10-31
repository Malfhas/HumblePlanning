import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVehicleAssignments } from "@/lib/services/vehicle-assignment-service";
import { getEquipmentScope } from "@/lib/services/equipment-scope";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "pages:vehicles");
    const { id } = await params;
    const assignments = await getVehicleAssignments(await getEquipmentScope(perms), id);
    return apiSuccess(assignments);
  } catch (error) {
    return handleApiError(error);
  }
}
