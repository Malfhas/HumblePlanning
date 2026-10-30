import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVehicles, createVehicle } from "@/lib/services/vehicle-service";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  vehicleTypeId: z.string().uuid().optional().nullable(),
  businessUnitId: z.string().uuid("Business Unit requise"),
  registrationNumber: z.string().max(50).optional().nullable(),
  color: z.string().max(7).optional(),
  status: z.enum(["available", "maintenance", "out_of_service"]).optional(),
  comment: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    await requireAuth();
    // Auth-only: vehicles are reference data used by planning/forms.
    const url = new URL(request.url);
    const includeOutOfService = url.searchParams.get("includeOutOfService") !== "false";
    const vehicles = await getVehicles(includeOutOfService);
    return apiSuccess(vehicles);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicles:create");
    const data = await validateBody(request, createSchema);
    const vehicle = await createVehicle(data);
    return apiSuccess(vehicle, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
