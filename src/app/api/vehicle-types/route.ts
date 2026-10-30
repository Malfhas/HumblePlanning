import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVehicleTypes, createVehicleType } from "@/lib/services/vehicle-type-service";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  color: z.string().max(7).optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: vehicle types are reference data used by planning/forms.
    const types = await getVehicleTypes();
    return apiSuccess(types);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicle_types:create");
    const data = await validateBody(request, createSchema);
    const vt = await createVehicleType(data);
    return apiSuccess(vt, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
