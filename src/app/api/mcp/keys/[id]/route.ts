import { requireAuth, requirePermission, apiSuccess, handleApiError, assertUuid } from "@/lib/utils/api";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const [token] = await db.select({ clientName: mcpTokens.clientName }).from(mcpTokens).where(eq(mcpTokens.id, id));
    await db.update(mcpTokens)
      .set({ revokedAt: new Date() })
      .where(eq(mcpTokens.id, id));
    logAudit({
      userId: session.user.id,
      action: "mcp_key_delete",
      entityType: "mcp_key",
      entityId: id,
      metadata: { name: token?.clientName },
    }).catch(() => {});
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
