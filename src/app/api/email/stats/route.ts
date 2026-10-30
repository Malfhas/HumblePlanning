import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { db } from "@/db";
import { emailLogs } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");

    const [stats] = await db.execute<{
      today_success: string;
      today_error: string;
      yesterday_success: string;
      yesterday_error: string;
      month_success: string;
      month_error: string;
      last_month_success: string;
      last_month_error: string;
      total_success: string;
      total_error: string;
      // i18n-ignore SQL
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE AND status = 'success') AS today_success,
        COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE AND status = 'error') AS today_error,
        COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE - INTERVAL '1 day' AND sent_at < CURRENT_DATE AND status = 'success') AS yesterday_success,
        COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE - INTERVAL '1 day' AND sent_at < CURRENT_DATE AND status = 'error') AS yesterday_error,
        COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('month', CURRENT_DATE) AND status = 'success') AS month_success,
        COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('month', CURRENT_DATE) AND status = 'error') AS month_error,
        COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AND sent_at < DATE_TRUNC('month', CURRENT_DATE) AND status = 'success') AS last_month_success,
        COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AND sent_at < DATE_TRUNC('month', CURRENT_DATE) AND status = 'error') AS last_month_error,
        COUNT(*) FILTER (WHERE status = 'success') AS total_success,
        COUNT(*) FILTER (WHERE status = 'error') AS total_error
      FROM ${emailLogs}
    `);

    return apiSuccess({
      today: { success: Number(stats.today_success), error: Number(stats.today_error) },
      yesterday: { success: Number(stats.yesterday_success), error: Number(stats.yesterday_error) },
      month: { success: Number(stats.month_success), error: Number(stats.month_error) },
      lastMonth: { success: Number(stats.last_month_success), error: Number(stats.last_month_error) },
      total: { success: Number(stats.total_success), error: Number(stats.total_error) },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    // Only delete logs before current month — preserve "Ce mois" counter
    await db.execute(sql`DELETE FROM ${emailLogs} WHERE sent_at < DATE_TRUNC('month', CURRENT_DATE)`); // i18n-ignore SQL
    return apiSuccess({ reset: true });
  } catch (error) {
    return handleApiError(error);
  }
}
