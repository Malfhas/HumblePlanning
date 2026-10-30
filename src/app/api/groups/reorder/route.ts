import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { reorderGroups } from "@/lib/services/group-service";
import { z } from "zod";

const reorderSchema = z.object({
  groupIds: z.array(z.string().uuid()),
});

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "groups:edit");
    const { groupIds } = await validateBody(request, reorderSchema);
    await reorderGroups(groupIds);
    return apiSuccess({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
