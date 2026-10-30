import { requireAuth, requirePermission, handleApiError, apiSuccess, AppError, assertUuid } from "@/lib/utils/api";
import { getBackupById, getBackupStream, deleteBackup, getEncryptionKeyStatus } from "@/lib/services/backup-service";
import { refuseInDemo } from "@/lib/demo/guard";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:download");

    const { id } = await params;
    assertUuid(id);
    const record = await getBackupById(id);
    if (!record) throw new AppError("settings.errors.backupNotFound", { status: 404 });
    if (record.status !== "completed") throw new AppError("settings.errors.backupNotReady");

    const { configured } = getEncryptionKeyStatus();
    if (!configured) throw new AppError("settings.errors.backupKeyMissing");

    const decrypted = getBackupStream(record.filename);

    const downloadName = record.filename.replace(".enc", ".dump");

    const { logAudit } = await import("@/lib/services/audit-service");
    await logAudit({
      userId: session.user.id,
      action: "create",
      entityType: "backup_download",
      entityId: id,
      metadata: { filename: record.filename },
    });

    return new Response(new Uint8Array(decrypted), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": String(decrypted.length),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "backups:delete");

    const { id } = await params;
    assertUuid(id);
    await deleteBackup(id, session.user.id);
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
