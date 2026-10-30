import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getAdminQuotaState } from "@/lib/ai-chat/quota-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    return apiSuccess(await getAdminQuotaState());
  } catch (error) {
    return handleApiError(error);
  }
}
