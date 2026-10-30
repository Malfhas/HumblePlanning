import { requireAuth, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { updateProfileSchema } from "@/lib/validators/profile";
import { getProfile, updateProfile } from "@/lib/services/profile-service";

export async function GET() {
  try {
    const session = await requireAuth();
    const profile = await getProfile(session.user.id);
    return apiSuccess(profile);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    const data = await validateBody(request, updateProfileSchema);
    const user = await updateProfile(session.user.id, data);
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}
