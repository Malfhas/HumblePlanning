import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { reorderTeams } from "@/lib/services/team-service";
import { z } from "zod";

const reorderSchema = z.object({
  teamIds: z.array(z.string().uuid()),
});

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "teams:edit");
    const { teamIds } = await validateBody(request, reorderSchema);
    await reorderTeams(teamIds);
    return apiSuccess({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
