import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, ApiError, assertUuid } from "@/lib/utils/api";
import { getResourceAssignmentById, updateResourceAssignment, deleteResourceAssignment, isResourceAssignmentLocked } from "@/lib/services/resource-assignment-service";
import { getEquipmentScope, assertBookingWritable } from "@/lib/services/equipment-scope";
import { z } from "zod";

const updateSchema = z.object({
  resourceId: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  type: z.enum(["task", "reservation", "maintenance"]).optional(),
  isLocked: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "pages:resources");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    // Outside the scope it answers like a missing one
    const result = await getResourceAssignmentById(id, await getEquipmentScope(perms));
    if (!result) throw new ApiError("resources.errors.resourceAssignmentNotFound", 404);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "resources:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    // 404 unless on a resource of the user's business units; new references in scope
    await assertBookingWritable(perms, "resource", id, { equipmentId: data.resourceId, projectId: data.projectId });
    if (!("isLocked" in data) && await isResourceAssignmentLocked(id)) {
      return apiError("resources.errors.reservationLocked", 403);
    }
    const result = await updateResourceAssignment(id, data, session.user.id);
    const { emitTaskEvent } = await import("@/lib/socket-events");
    emitTaskEvent({ action: "updated", userId: session.user.id });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "resources:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await assertBookingWritable(perms, "resource", id, {});
    if (await isResourceAssignmentLocked(id)) {
      return apiError("resources.errors.reservationLocked", 403);
    }
    const result = await deleteResourceAssignment(id);
    const { emitTaskEvent } = await import("@/lib/socket-events");
    emitTaskEvent({ action: "deleted", userId: session.user.id });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
