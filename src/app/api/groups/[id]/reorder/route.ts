import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { reorderGroupProjects } from "@/lib/services/group-service";
import { z } from "zod";

const reorderSchema = z.object({
  projectIds: z.array(z.string().uuid()),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "groups:edit");
    const { id } = await params;
    const { projectIds } = await validateBody(request, reorderSchema);
    await reorderGroupProjects(id, projectIds);
    return apiSuccess({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
