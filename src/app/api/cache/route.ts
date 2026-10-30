import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getCacheStats, clearCache, reloadCacheSettings } from "@/lib/cache";
import { getServerTranslator } from "@/i18n/server-translator";
import { resolveRequestLocale } from "@/i18n/resolve-locale";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");
    return apiSuccess(getCacheStats());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    clearCache();
    reloadCacheSettings();
    const t = await getServerTranslator(await resolveRequestLocale());
    return apiSuccess({ success: true, message: t("settings.panels.cache.cleared") });
  } catch (error) {
    return handleApiError(error);
  }
}
