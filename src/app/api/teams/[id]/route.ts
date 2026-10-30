import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getTeamById, updateTeam, deleteTeam } from "@/lib/services/team-service";
import { z } from "zod";

const updateTeamSchema = z.object({
  name: z.string().min(1).max(150),
  color: z.string().max(7),
  businessUnitId: z.string().uuid(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:teams");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const team = await getTeamById(id);
    if (!team) return apiError("users.errors.teamNotFound", 404);
    return apiSuccess(team);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "teams:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateTeamSchema);
    const team = await updateTeam(id, data);
    if (!team) return apiError("users.errors.teamNotFound", 404);
    return apiSuccess(team);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "teams:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const team = await deleteTeam(id);
    if (!team) return apiError("users.errors.teamNotFound", 404);
    return apiSuccess(team);
  } catch (error) {
    return handleApiError(error);
  }
}
