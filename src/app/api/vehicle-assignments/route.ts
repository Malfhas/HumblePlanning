import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVehicleAssignments, createVehicleAssignment } from "@/lib/services/vehicle-assignment-service";
import { z } from "zod";

const createSchema = z.object({
  vehicleId: z.string().uuid(),
  taskId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  type: z.enum(["task", "reservation", "maintenance"]).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAuth();
    // Auth-only: vehicle assignments are loaded by the planning grid.
    const url = new URL(request.url);
    const vehicleId = url.searchParams.get("vehicleId") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const assignments = await getVehicleAssignments(vehicleId, startDate, endDate);
    return apiSuccess(assignments);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicles:create");
    const data = await validateBody(request, createSchema);
    const assignment = await createVehicleAssignment({
      ...data,
      assignedBy: session.user.id,
    });
    const { emitTaskEvent } = await import("@/lib/socket-events");
    emitTaskEvent({ action: "created", userId: session.user.id });
    return apiSuccess(assignment, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
