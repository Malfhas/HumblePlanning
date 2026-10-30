import { requireAuth, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getSavedFilters, createSavedFilter } from "@/lib/services/filter-service";
import { createSavedFilterSchema } from "@/lib/validators/filter";

export async function GET() {
  try {
    const session = await requireAuth();
    const filters = await getSavedFilters(session.user.id);
    return apiSuccess(filters);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const data = await validateBody(request, createSavedFilterSchema);
    const filter = await createSavedFilter(session.user.id, data);
    return apiSuccess(filter, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
