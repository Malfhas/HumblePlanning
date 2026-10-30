import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { cleanupImport } from "@/lib/services/import-service";
import { refuseInDemo } from "@/lib/demo/guard";

export async function DELETE(request: Request) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    await requireAuth();
    await cleanupImport();
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
