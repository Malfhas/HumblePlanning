import { requireAuth, requirePermission, apiSuccess, handleApiError, assertUuid } from "@/lib/utils/api";
import { unblockEmail } from "@/lib/services/email-blocklist-service";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const { id } = await params;
    assertUuid(id);
    await unblockEmail(id, session.user.id);
    return apiSuccess({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
