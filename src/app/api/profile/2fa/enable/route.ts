import { requireAuth, handleApiError, AppError, apiSuccess } from "@/lib/utils/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { accounts } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import { verifyPassword } from "@/lib/password";
import { generateSecret, generateURI } from "otplib";
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

    // Check if already enabled
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { twoFactorEnabled: true, name: true, email: true },
    });
    if (user?.twoFactorEnabled) throw new AppError("profile.errors.twoFactorAlreadyEnabled");

    // Generate TOTP secret
    const secret = generateSecret();
    const issuer = "HumblePlanning";
    const label = user?.email || user?.name || session.user.id;
    const totpURI = generateURI({ strategy: "totp", issuer, label, secret });

    // Store secret temporarily (not yet enabled)
    await db.update(users).set({ twoFactorSecret: secret }).where(eq(users.id, session.user.id));

    logAudit({
      userId: session.user.id,
      action: "2fa_enable",
      entityType: "user",
      entityId: session.user.id,
      metadata: { step: "setup_started" },
    }).catch(() => {});

    return apiSuccess({ totpURI, secret });
  } catch (error) {
    return handleApiError(error);
  }
}
