import { requireAuth, handleApiError, AppError, apiSuccess } from "@/lib/utils/api";
import { uploadAvatar, deleteAvatar } from "@/lib/services/profile-service";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif"];
const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const session = await requireAuth();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new AppError("errors.noFile");
    if (file.size > MAX_SIZE_BYTES) throw new AppError("profile.errors.avatarTooLarge", { params: { max: MAX_SIZE_MB } });

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new AppError("profile.errors.extensionNotAllowed", { params: { ext } });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = await uploadAvatar(session.user.id, buffer, file.name);
    return apiSuccess({ path });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const session = await requireAuth();
    await deleteAvatar(session.user.id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
