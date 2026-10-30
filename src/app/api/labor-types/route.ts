import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getLaborTypes, createLaborType } from "@/lib/services/labor-type-service";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  initials: z.string().min(1).max(10),
  sortOrder: z.number().int().optional(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: labor types are reference data used by planning/forms.
    const types = await getLaborTypes();
    return apiSuccess(types);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "labor_types:edit");
    const data = await validateBody(request, createSchema);
    const lt = await createLaborType(data);
    return apiSuccess(lt, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
