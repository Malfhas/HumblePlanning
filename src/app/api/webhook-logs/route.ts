import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getWebhookLogs } from "@/lib/services/webhook-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");
    const provider = request.nextUrl.searchParams.get("provider") || "nuntly";
    const page = parseInt(request.nextUrl.searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "20", 10), 100);
    const result = await getWebhookLogs(provider, page, limit);
    return apiSuccess(result);
  } catch (err) {
    return handleApiError(err);
  }
}
