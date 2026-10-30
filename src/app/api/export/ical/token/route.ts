import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";

/** GET: Fetch the current user's iCal token (null if not generated). */
export async function GET() {
  try {
    const session = await requireAuth();
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { icalToken: true },
    });
    return apiSuccess({ token: user?.icalToken ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE: Revoke the current user's iCal token. */
export async function DELETE() {
  try {
    const session = await requireAuth();
    await db.update(users)
      .set({ icalToken: null })
      .where(eq(users.id, session.user.id));
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
