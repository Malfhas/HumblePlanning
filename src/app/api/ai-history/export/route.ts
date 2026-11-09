import { NextRequest } from "next/server";
import { requireAuth, requirePermission, handleApiError } from "@/lib/utils/api";
import { exportAiConversations } from "@/lib/services/ai-history-service";
import { getConfigValues } from "@/lib/services/config-service";
import { aiHistoryFiltersSchema, parseQuery } from "@/lib/validators/system-health";
import { periodSince } from "@/lib/system-health/retention";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";
import { dateSettingsFromConfig, formatDateTime } from "@/lib/utils/dates";
import { escapeCsvCell } from "@/lib/utils/csv";
import { tDyn } from "@/i18n/dynamic";

// i18n-dynamic: admin.aiHistory.columns.*

/** AI history: the filtered conversation list as CSV (`;`, UTF-8 with BOM, like the other exports). */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:ai_history");
    const { days, userIds, models } = parseQuery(aiHistoryFiltersSchema, request.nextUrl.searchParams);
    const rows = await exportAiConversations({ since: periodSince(new Date(), days), userIds, models });

    const locale = await resolveRequestLocale();
    const t = await getServerTranslator(locale);
    const dates = dateSettingsFromConfig(await getConfigValues(["PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE"]));
    const headers = ["lastActivity", "title", "deleted", "user", "models", "messages", "promptTokens", "completionTokens", "cost", "errors"]
      .map((column) => escapeCsvCell(tDyn(t, `admin.aiHistory.columns.${column}`)));
    const lines = rows.map((row) => [
      escapeCsvCell(formatDateTime(row.updatedAt, locale, dates)),
      escapeCsvCell(row.title),
      escapeCsvCell(row.deletedAt ? t("common.boolean.yes") : t("common.boolean.no")),
      escapeCsvCell(row.userName),
      escapeCsvCell(row.models.join(", ")),
      escapeCsvCell(row.messages),
      escapeCsvCell(row.promptTokens),
      escapeCsvCell(row.completionTokens),
      escapeCsvCell(Number(row.costUsd)),
      escapeCsvCell(row.errors),
    ].join(";"));

    const csv = "﻿" + [headers.join(";"), ...lines].join("\r\n");
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-history_${today}.csv"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
