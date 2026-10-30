import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getGroups, createGroup } from "@/lib/services/group-service";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(7),
  sortOrder: z.number().int().optional(),
  businessUnitId: z.string().uuid(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: project groups are reference data used by project form dropdowns.
    const groups = await getGroups();
    return apiSuccess(groups);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "groups:edit");
    const data = await validateBody(request, createGroupSchema);
    const group = await createGroup(data);
    return apiSuccess(group, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
