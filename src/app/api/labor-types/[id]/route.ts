import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getLaborTypeById, updateLaborType, deleteLaborType } from "@/lib/services/labor-type-service";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100),
  initials: z.string().min(1).max(10),
  sortOrder: z.number().int().optional(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:labor_types");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const lt = await getLaborTypeById(id);
    if (!lt) return apiError("projects.errors.laborTypeNotFound", 404);
    return apiSuccess(lt);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "labor_types:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSchema);
    const lt = await updateLaborType(id, data);
    if (!lt) return apiError("projects.errors.laborTypeNotFound", 404);
    return apiSuccess(lt);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "labor_types:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const lt = await deleteLaborType(id);
    if (!lt) return apiError("projects.errors.laborTypeNotFound", 404);
    return apiSuccess(lt);
  } catch (error) {
    return handleApiError(error);
  }
}
