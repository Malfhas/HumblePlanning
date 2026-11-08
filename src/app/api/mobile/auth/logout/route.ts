import { apiSuccess, getAuthSession, handleApiError } from "@/lib/utils/api";
import { logAudit } from "@/lib/services/audit-service";
import { revokeCurrentSession } from "@/lib/services/mobile-service";

/** POST /api/mobile/auth/logout: ends this session on the server. Without a valid session, nothing to do. */
export async function POST() {
  try {
    const session = await getAuthSession();
    if (session) {
      await revokeCurrentSession(session.session.id);
      logAudit({ userId: session.user.id, action: "session_revoke", entityType: "user", entityId: session.user.id, metadata: { method: "mobile" } }).catch(() => {});
    }
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
