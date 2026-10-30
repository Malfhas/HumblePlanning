import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getSavedFilterById, updateSavedFilter, deleteSavedFilter } from "@/lib/services/filter-service";
import { updateSavedFilterSchema } from "@/lib/validators/filter";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const filter = await getSavedFilterById(id, session.user.id);
    if (!filter) return apiError("admin.filters.errors.notFound");
    return apiSuccess(filter);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateSavedFilterSchema);
    const filter = await updateSavedFilter(id, session.user.id, data);
    if (!filter) return apiError("admin.filters.errors.notFound");
    return apiSuccess(filter);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const filter = await deleteSavedFilter(id, session.user.id);
    if (!filter) return apiError("admin.filters.errors.notFound");
    return apiSuccess(filter);
  } catch (error) {
    return handleApiError(error);
  }
}
