import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { reorderTeamUsers } from "@/lib/services/user-service";
import { z } from "zod";

const reorderSchema = z.object({
  userIds: z.array(z.string().uuid()),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "teams:edit");
    const { id } = await params;
    const { userIds } = await validateBody(request, reorderSchema);
    await reorderTeamUsers(id, userIds);
    return apiSuccess({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
