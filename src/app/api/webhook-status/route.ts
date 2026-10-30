import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getNuntlyWebhookStatus } from "@/lib/services/webhook-service";
import { getConfigValue } from "@/lib/services/config-service";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");
    const status = await getNuntlyWebhookStatus();
    const baseUrl = await getConfigValue("APP_BASE_URL");
    const webhookUrl = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/webhooks/nuntly` : null;
    return apiSuccess({ ...status, webhookUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
