import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getResourceTypes, createResourceType } from "@/lib/services/resource-type-service";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  color: z.string().max(7).optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: resource types are reference data used by planning/forms.
    return apiSuccess(await getResourceTypes());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "resource_types:edit");
    const data = await validateBody(request, createSchema);
    return apiSuccess(await createResourceType(data), 201);
  } catch (error) {
    return handleApiError(error);
  }
}
