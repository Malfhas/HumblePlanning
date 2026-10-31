import { requireAuth, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { changePasswordSchema } from "@/lib/validators/profile";
import { changeProfilePassword } from "@/lib/services/profile-service";

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    const data = await validateBody(request, changePasswordSchema);
    // Other sessions are revoked, the current one is kept (with an API key, no
    // session carries the key's id, so every session is revoked).
    const result = await changeProfilePassword(session.user.id, data.currentPassword, data.newPassword, session.session.id);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
