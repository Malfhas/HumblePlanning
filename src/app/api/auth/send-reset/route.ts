import { db } from "@/db";
import { users } from "@/db/schema";
import { verifications } from "@/db/schema/auth";
import { eq } from "drizzle-orm";
import { requireAuth, requirePermission, apiSuccess, validateBody, handleApiError, AppError } from "@/lib/utils/api";
import { getConfigValues } from "@/lib/services/config-service";
import { passwordResetTemplate } from "@/lib/services/email-templates";
import { sendEmail } from "@/lib/services/email-service";
import { sendPasswordResetSchema } from "@/lib/validators/user";
import { logger } from "@/lib/logger";
import { assertNotDemoAccount } from "@/lib/demo";
import { refuseInDemo } from "@/lib/demo/guard";
import { resolveRecipientLocale } from "@/i18n/resolve-locale";

const RESET_TOKEN_EXPIRY_MINUTES = 10;

// Rate limiting: 1 reset email per user per 60 seconds
const resetCooldowns = new Map<string, number>();
const COOLDOWN_SECONDS = 60;

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of resetCooldowns) {
    if (now - timestamp > COOLDOWN_SECONDS * 1000 + 10_000) {
      resetCooldowns.delete(key);
    }
  }
}, 5 * 60 * 1000);

export async function POST(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "users:edit");

    const { userId } = await validateBody(request, sendPasswordResetSchema);
    assertNotDemoAccount(userId);

    // Check cooldown
    const lastSent = resetCooldowns.get(userId);
    if (lastSent) {
      const elapsed = Math.floor((Date.now() - lastSent) / 1000);
      if (elapsed < COOLDOWN_SECONDS) {
        const remaining = COOLDOWN_SECONDS - elapsed;
        throw new AppError("auth.errors.resetAlreadySent", { status: 429, params: { count: remaining } });
      }
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, name: true, email: true, locale: true },
    });

    if (!user) throw new AppError("users.errors.notFound", { status: 404 });
    if (!user.email) throw new AppError("users.errors.noEmail");

    // Generate a secure token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

    // Clean up any existing reset tokens for this user
    await db.delete(verifications).where(eq(verifications.identifier, `reset:${userId}`));

    // Store the token in the verification table
    await db.insert(verifications).values({
      id: crypto.randomUUID(),
      identifier: `reset:${userId}`,
      value: token,
      expiresAt,
    });

    // Build reset URL and send email
    const appConfig = await getConfigValues(["APP_TITLE", "APP_BASE_URL"]);
    const baseUrl = appConfig.APP_BASE_URL || "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const template = passwordResetTemplate(
      user.name,
      resetUrl,
      RESET_TOKEN_EXPIRY_MINUTES,
      appConfig.APP_TITLE ?? "HumblePlanning",
      baseUrl,
      // Sent by an admin: the recipient's language, not the admin's.
      await resolveRecipientLocale(user.locale)
    );

    await sendEmail({ to: user.email, ...template });

    // Record cooldown after successful send
    resetCooldowns.set(userId, Date.now());

    return apiSuccess({ success: true });
  } catch (err) {
    // Coded errors (missing session, permission denied…): translated by handleApiError.
    if (err instanceof AppError) return handleApiError(err);
    logger.error("auth", "send-reset error", { error: err instanceof Error ? err.message : String(err) });
    return handleApiError(new AppError("errors.internal", { status: 500 }));
  }
}
