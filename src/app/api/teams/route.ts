import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getTeams, createTeam } from "@/lib/services/team-service";
import { z } from "zod";

const createTeamSchema = z.object({
  name: z.string().min(1).max(150),
  color: z.string().min(1).max(7),
  businessUnitId: z.string().uuid(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: teams are reference data used by planning filters, task form,
    // user form — must be accessible regardless of pages:teams permission.
    const teams = await getTeams();
    return apiSuccess(teams);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "teams:edit");
    const data = await validateBody(request, createTeamSchema);
    const team = await createTeam(data);
    return apiSuccess(team, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
