import { requireAuth, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { updatePreferencesSchema } from "@/lib/validators/profile";
import { updatePreferences } from "@/lib/services/profile-service";

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    const data = await validateBody(request, updatePreferencesSchema);
    const prefs = await updatePreferences(session.user.id, data);
    return apiSuccess(prefs);
  } catch (error) {
    return handleApiError(error);
  }
}
