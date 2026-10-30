import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getPlaceById, updatePlace, deletePlace } from "@/lib/services/place-service";
import { z } from "zod";

const updatePlaceSchema = z.object({
  name: z.string().min(1).max(100),
  comment: z.string().optional(),
  exclusive: z.boolean().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:places");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const place = await getPlaceById(id);
    if (!place) return apiError("resources.errors.placeNotFound", 404);
    return apiSuccess(place);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "places:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updatePlaceSchema);
    const place = await updatePlace(id, data);
    if (!place) return apiError("resources.errors.placeNotFound", 404);
    return apiSuccess(place);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "places:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const place = await deletePlace(id);
    if (!place) return apiError("resources.errors.placeNotFound", 404);
    return apiSuccess(place);
  } catch (error) {
    return handleApiError(error);
  }
}
