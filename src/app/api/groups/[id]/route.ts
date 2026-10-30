import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getGroupById, updateGroup, deleteGroup } from "@/lib/services/group-service";
import { z } from "zod";

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(7),
  sortOrder: z.number().int().optional(),
  businessUnitId: z.string().uuid(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:projects");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const group = await getGroupById(id);
    if (!group) return apiError("projects.errors.groupNotFound", 404);
    return apiSuccess(group);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "groups:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateGroupSchema);
    const group = await updateGroup(id, data);
    if (!group) return apiError("projects.errors.groupNotFound", 404);
    return apiSuccess(group);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "groups:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const group = await deleteGroup(id);
    if (!group) return apiError("projects.errors.groupNotFound", 404);
    return apiSuccess(group);
  } catch (error) {
    return handleApiError(error);
  }
}
