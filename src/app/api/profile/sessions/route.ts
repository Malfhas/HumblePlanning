import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getUserSessions } from "@/lib/services/profile-service";

export async function GET() {
  try {
    const session = await requireAuth();
    const sessions = await getUserSessions(session.user.id);
    return apiSuccess(sessions);
  } catch (error) {
    return handleApiError(error);
  }
}
