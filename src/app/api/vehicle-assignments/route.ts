import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getVehicleAssignments, createVehicleAssignment } from "@/lib/services/vehicle-assignment-service";
import { loadUserPermissions } from "@/lib/services/permission-service";
import { getEquipmentScope, assertBookingWritable } from "@/lib/services/equipment-scope";
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
    const session = await requireAuth();
    // No page permission: the planning grid, the home page and the task
    // preview load them. Limited by `getEquipmentScope`.
    const scope = await getEquipmentScope(await loadUserPermissions(session.user.id));
    const url = new URL(request.url);
    const vehicleId = url.searchParams.get("vehicleId") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const assignments = await getVehicleAssignments(scope, vehicleId, startDate, endDate);
    return apiSuccess(assignments);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "vehicles:create");
    const data = await validateBody(request, createSchema);
    // A vehicle of the user's business units, a readable project / task
    await assertBookingWritable(perms, "vehicle", null, { equipmentId: data.vehicleId, projectId: data.projectId, taskId: data.taskId });
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
