import { requireAuth, handleApiError, AppError, apiSuccess } from "@/lib/utils/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySync } from "otplib";
import crypto from "node:crypto";
import { logAudit } from "@/lib/services/audit-service";
import { assertNotDemoAccount } from "@/lib/demo";

function generateBackupCodes(count = 5): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    assertNotDemoAccount(session.user.id);
    const { code } = await request.json();

    if (!code || typeof code !== "string") throw new AppError("profile.errors.codeRequired");

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user?.twoFactorSecret) throw new AppError("profile.errors.noTwoFactorSetup");
    if (user.twoFactorEnabled) throw new AppError("profile.errors.twoFactorAlreadyEnabled");

    // Verify TOTP code
    const result = verifySync({ token: code, secret: user.twoFactorSecret });
    if (!result.valid) throw new AppError("profile.errors.invalidTotpCode");

    // Generate backup codes
    const backupCodes = generateBackupCodes(5);

    // Enable 2FA
    await db.update(users).set({
      twoFactorEnabled: true,
      twoFactorBackupCodes: JSON.stringify(backupCodes),
    }).where(eq(users.id, session.user.id));

    logAudit({
      userId: session.user.id,
      action: "2fa_enable",
      entityType: "user",
      entityId: session.user.id,
      metadata: { step: "verified_and_enabled" },
    }).catch(() => {});

    return apiSuccess({ backupCodes });
  } catch (error) {
    return handleApiError(error);
  }
}
