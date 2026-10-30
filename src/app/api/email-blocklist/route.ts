import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getBlockedEmails } from "@/lib/services/email-blocklist-service";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const data = await getBlockedEmails();
    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
