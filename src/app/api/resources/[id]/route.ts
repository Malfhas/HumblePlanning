import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, ApiError, assertUuid } from "@/lib/utils/api";
import { getResourceById, updateResource, deleteResource } from "@/lib/services/resource-service";
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
    await requirePermission(session.user.id, "pages:resources");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const resource = await getResourceById(id);
    if (!resource) throw new ApiError("resources.errors.resourceNotFound", 404);
    return apiSuccess(resource);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "resources:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    return apiSuccess(await updateResource(id, data));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "resources:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    return apiSuccess(await deleteResource(id));
  } catch (error) {
    return handleApiError(error);
  }
}
