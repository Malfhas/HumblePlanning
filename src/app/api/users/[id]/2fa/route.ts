import { requireAuth, requirePermission, handleApiError, apiSuccess } from "@/lib/utils/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assertNotDemoAccount } from "@/lib/demo";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "users:edit");
    const { id } = await params;
    assertNotDemoAccount(id);

    await db.update(users).set({
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    }).where(eq(users.id, id));

    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
