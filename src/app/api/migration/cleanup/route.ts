import { requireAuth, apiSuccess, handleApiError } from "@/lib/utils/api";
import { cleanupMigration } from "@/lib/services/migration-service";

export async function DELETE() {
  try {
    await requireAuth();
    cleanupMigration();
    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
