import { db } from "@/db";
import { users } from "@/db/schema";
import { accounts } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import { getAuthSession, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { hashPassword } from "@/lib/password";
import { getConfigValues } from "@/lib/services/config-service";
import { policyFromConfig, evaluatePassword, PWD_CONFIG_KEYS } from "@/lib/password-policy";
import { isPasswordReused, isPasswordBlacklisted, addPasswordToHistory } from "@/lib/services/password-history-service";
import { logAudit } from "@/lib/services/audit-service";
import { passwordNotCompliantError, passwordRejectedError } from "@/lib/services/user-service";
import { revokeOtherSessions } from "@/lib/services/profile-service";
import { assertNotDemoAccount } from "@/lib/demo";

/**
 * Forced password change (/change-password screen), without the current
 * password: only for an account flagged `forcePasswordChange`, signed in with
 * a session cookie (never an API key). The voluntary change goes through
 * /api/profile/password, which checks the current password.
 */
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session) throw new AppError("errors.unauthenticated");
    const userId = session.user.id;

    assertNotDemoAccount(userId);

    const account = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { active: true, forcePasswordChange: true },
    });
    if (!account || account.active === false) throw new AppError("errors.unauthenticated");
    if (!account.forcePasswordChange) throw new AppError("auth.errors.passwordChangeNotRequired", { status: 403 });

    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== "string") {
      throw new AppError("auth.errors.passwordRequired");
    }

    // Validate against policy
    const config = await getConfigValues([...PWD_CONFIG_KEYS]);
    const policy = policyFromConfig(config);
    const strength = evaluatePassword(password, policy);

    if (!strength.valid) throw await passwordNotCompliantError(strength, { status: 400 });

    // Check blacklist
    const blacklisted = await isPasswordBlacklisted(password);
    if (blacklisted) {
      throw passwordRejectedError("users.errors.passwordBlacklisted");
    }

    // Check password history
    const reused = await isPasswordReused(userId, password);
    if (reused) {
      throw passwordRejectedError("users.errors.passwordReused");
    }

    // Hash and update the credential account
    const hashed = await hashPassword(password);
    const existing = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")),
      columns: { id: true },
    });

    if (existing) {
      await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, existing.id));
    } else {
      await db.insert(accounts).values({
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: hashed,
      });
    }

    // Record in password history
    await addPasswordToHistory(userId, hashed);

    // Reset forcePasswordChange flag
    await db.update(users).set({ forcePasswordChange: false }).where(eq(users.id, userId));

    // The new password signs out the other devices (this session stays open)
    await revokeOtherSessions(userId, session.session.id);

    const selfUser = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { name: true, username: true } });
    await logAudit({ userId, action: "password_change", entityType: "user", entityId: userId, metadata: { method: "self_change", targetUser: selfUser?.name, targetLogin: selfUser?.username } });

    return apiSuccess({ success: true });
  } catch (err) {
    // Coded errors (missing session, password rejected…): translated by handleApiError.
    if (err instanceof AppError) return handleApiError(err);
    return handleApiError(new AppError("errors.internal", { status: 500 }));
  }
}
