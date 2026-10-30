import { NextRequest } from "next/server";
import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { isEmailBlocked, isBlocklistActive } from "@/lib/services/email-blocklist-service";

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const email = request.nextUrl.searchParams.get("email") || "";
    if (!email) return apiSuccess({ blocked: false, active: false });
    const active = await isBlocklistActive();
    if (!active) return apiSuccess({ blocked: false, active: false });
    const blocked = await isEmailBlocked(email);
    return apiSuccess({ blocked, active: true });
  } catch (err) {
    return handleApiError(err);
  }
}
