import { requireAuth, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { changePasswordSchema } from "@/lib/validators/profile";
import { changeProfilePassword } from "@/lib/services/profile-service";

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    const data = await validateBody(request, changePasswordSchema);
    const result = await changeProfilePassword(session.user.id, data.currentPassword, data.newPassword);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
