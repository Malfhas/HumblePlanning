import { requireAuth, requirePermission, handleApiError, apiSuccess, assertUuid } from "@/lib/utils/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assertNotDemoAccount } from "@/lib/demo";
import { assertCanManageUser } from "@/lib/services/user-access";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "users:edit");
    const { id } = await params;
    assertUuid(id);
    assertNotDemoAccount(id);
    // Resetting the 2FA of a more privileged account would allow taking it over
    await assertCanManageUser(perms, { targetId: id });

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
