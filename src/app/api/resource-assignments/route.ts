import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getResourceAssignments, createResourceAssignment } from "@/lib/services/resource-assignment-service";
import { loadUserPermissions } from "@/lib/services/permission-service";
import { getEquipmentScope, assertBookingWritable } from "@/lib/services/equipment-scope";
import { z } from "zod";

const createSchema = z.object({
  resourceId: z.string().uuid(),
  taskId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  type: z.enum(["task", "reservation", "maintenance"]).default("reservation"),
});

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    // No page permission: the planning grid, the home page and the task
    // preview load them. Limited by `getEquipmentScope`.
    const scope = await getEquipmentScope(await loadUserPermissions(session.user.id));
    const url = new URL(request.url);
    const resourceId = url.searchParams.get("resourceId") ?? undefined;
    const startDate = url.searchParams.get("startDate") ?? undefined;
    const endDate = url.searchParams.get("endDate") ?? undefined;
    return apiSuccess(await getResourceAssignments(scope, resourceId, startDate, endDate));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "resources:create");
    const data = await validateBody(request, createSchema);
    // A resource of the user's business units, a readable project / task
    await assertBookingWritable(perms, "resource", null, { equipmentId: data.resourceId, projectId: data.projectId, taskId: data.taskId });
    const result = await createResourceAssignment({ ...data, assignedBy: session.user.id });
    const { emitTaskEvent } = await import("@/lib/socket-events");
    emitTaskEvent({ action: "created", userId: session.user.id });
    return apiSuccess(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
