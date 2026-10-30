import { AppError, requireAuth, apiSuccess } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { readAttachment } from "@/lib/ai-chat/attachments";
import { handleChatError } from "@/lib/ai-chat/http";
import { refuseInDemo } from "@/lib/demo/guard";

export const dynamic = "force-dynamic";

/**
 * Attachment (20 MB max). Excluded from the proxy `matcher`: the Edge runtime
 * would silently truncate bodies over 10 MB there.
 */
export async function POST(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await assertAiChatAvailable(session.user.id);
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) throw new AppError("errors.noFile");
    return apiSuccess(await readAttachment(file));
  } catch (error) {
    return handleChatError(error);
  }
}
