import { NextRequest } from "next/server";
import { requireAuth, handleApiError, apiSuccess } from "@/lib/utils/api";
import { getUserNotifications } from "@/lib/services/push-notification-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);

    const result = await getUserNotifications(session.user.id, page, limit);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
