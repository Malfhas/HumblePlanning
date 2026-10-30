import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getPlaces, createPlace } from "@/lib/services/place-service";
import { z } from "zod";

const createPlaceSchema = z.object({
  name: z.string().min(1).max(100),
  comment: z.string().optional(),
  exclusive: z.boolean().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: places are reference data used by task form dropdowns.
    const places = await getPlaces();
    return apiSuccess(places);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "places:edit");
    const data = await validateBody(request, createPlaceSchema);
    const place = await createPlace(data);
    return apiSuccess(place, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
