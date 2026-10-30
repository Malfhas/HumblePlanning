import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { logAudit } from "@/lib/services/audit-service";
import { count } from "drizzle-orm";

export async function DELETE() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");

    // Count before purge
    const [{ value: total }] = await db.select({ value: count() }).from(notifications);

    // Delete all notifications
    await db.delete(notifications);

    await logAudit({
      userId: session.user.id,
      action: "purge",
      entityType: "notification",
      metadata: { count: Number(total) },
    });

    return apiSuccess({ purged: Number(total) });
  } catch (error) {
    return handleApiError(error);
  }
}
