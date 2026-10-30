import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getVehicleAssignmentById, updateVehicleAssignment, deleteVehicleAssignment, isVehicleAssignmentLocked } from "@/lib/services/vehicle-assignment-service";
import { z } from "zod";

const updateSchema = z.object({
  vehicleId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  notes: z.string().nullable(),
  type: z.enum(["task", "reservation", "maintenance"]),
  isLocked: z.boolean(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:vehicles");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const assignment = await getVehicleAssignmentById(id);
    if (!assignment) return apiError("resources.errors.vehicleAssignmentNotFound", 404);
    return apiSuccess(assignment);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicles:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    if (!("isLocked" in data) && await isVehicleAssignmentLocked(id)) {
      return apiError("resources.errors.reservationLocked", 403);
    }
    const assignment = await updateVehicleAssignment(id, data, session.user.id);
    if (!assignment) return apiError("resources.errors.vehicleAssignmentNotFound", 404);
    const { emitTaskEvent } = await import("@/lib/socket-events");
    emitTaskEvent({ action: "updated", userId: session.user.id });
    return apiSuccess(assignment);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "vehicles:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    if (await isVehicleAssignmentLocked(id)) {
      return apiError("resources.errors.reservationLocked", 403);
    }
    const assignment = await deleteVehicleAssignment(id);
    if (!assignment) return apiError("resources.errors.vehicleAssignmentNotFound", 404);
    const { emitTaskEvent } = await import("@/lib/socket-events");
    emitTaskEvent({ action: "deleted", userId: session.user.id });
    return apiSuccess(assignment);
  } catch (error) {
    return handleApiError(error);
  }
}
