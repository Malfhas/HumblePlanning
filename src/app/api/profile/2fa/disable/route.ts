import { requireAuth, handleApiError, AppError, apiSuccess } from "@/lib/utils/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { accounts } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import { verifyPassword } from "@/lib/password";
import { getConfigValues } from "@/lib/services/config-service";
import { logAudit } from "@/lib/services/audit-service";
import { assertNotDemoAccount } from "@/lib/demo";

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    assertNotDemoAccount(session.user.id);
    const { password } = await request.json();

    if (!password) throw new AppError("auth.errors.passwordRequired");

    // Verify password
    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, session.user.id), eq(accounts.providerId, "credential")),
      columns: { password: true },
    });
    if (!account?.password) throw new AppError("profile.errors.noPassword");

    const valid = await verifyPassword({ password, hash: account.password });
    if (!valid) throw new AppError("profile.errors.incorrectPassword");

    // Check if 2FA is mandatory
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { forceTwoFactor: true },
    });

    const config = await getConfigValues(["TWOFACTOR_REQUIRED"]);
    const globalRequired = config.TWOFACTOR_REQUIRED === "true";

    if (globalRequired || user?.forceTwoFactor) {
      throw new AppError("profile.errors.twoFactorMandatory");
    }

    // Disable 2FA
    await db.update(users).set({
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    }).where(eq(users.id, session.user.id));

    logAudit({
      userId: session.user.id,
      action: "2fa_disable",
      entityType: "user",
      entityId: session.user.id,
    }).catch(() => {});

    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
