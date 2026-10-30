import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, ApiError, assertUuid } from "@/lib/utils/api";
import { getResourceTypeById, updateResourceType, deleteResourceType } from "@/lib/services/resource-type-service";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(7).optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:resource_types");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const result = await getResourceTypeById(id);
    if (!result) throw new ApiError("resources.errors.resourceTypeNotFound", 404);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "resource_types:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    return apiSuccess(await updateResourceType(id, data));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "resource_types:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    return apiSuccess(await deleteResourceType(id));
  } catch (error) {
    return handleApiError(error);
  }
}
