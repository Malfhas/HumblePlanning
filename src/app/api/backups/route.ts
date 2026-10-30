import { requireAuth, requirePermission, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { createBackup, getBackupHistory, getEncryptionKeyStatus } from "@/lib/services/backup-service";
import { refuseInDemo } from "@/lib/demo/guard";

export async function GET(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:backups");

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));

    const result = await getBackupHistory(page, limit);
    const keyStatus = getEncryptionKeyStatus();

    return apiSuccess({ ...result, encryptionKeyConfigured: keyStatus.configured });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:create");

    const { configured } = getEncryptionKeyStatus();
    if (!configured) {
      throw new AppError("settings.errors.backupKeyMissing");
    }

    const backup = await createBackup(session.user.id, "manual");
    return apiSuccess(backup, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
