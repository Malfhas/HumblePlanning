import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, ApiError, assertUuid } from "@/lib/utils/api";
import { getResourceById, updateResource, deleteResource } from "@/lib/services/resource-service";
import { getVisibleBusinessUnitIds } from "@/lib/services/permission-service";
import { isEquipmentVisible, assertEquipmentWritable } from "@/lib/services/equipment-scope";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  resourceTypeId: z.string().uuid().nullable().optional(),
  businessUnitId: z.string().uuid().optional(),
  serialNumber: z.string().max(50).nullable().optional(),
  color: z.string().max(7).optional(),
  status: z.enum(["available", "maintenance", "out_of_service"]).optional(),
  comment: z.string().nullable().optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "pages:resources");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const resource = await getResourceById(id);
    // Outside the user's business units it answers like a missing one
    if (!resource || !isEquipmentVisible(resource, getVisibleBusinessUnitIds(perms))) {
      throw new ApiError("resources.errors.resourceNotFound", 404);
    }
    return apiSuccess(resource);
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
    // 404 outside the user's business units; a move stays within them
    await assertEquipmentWritable(perms, "resource", id, data.businessUnitId);
    return apiSuccess(await updateResource(id, data));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "resources:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    await assertEquipmentWritable(perms, "resource", id);
    return apiSuccess(await deleteResource(id));
  } catch (error) {
    return handleApiError(error);
  }
}
