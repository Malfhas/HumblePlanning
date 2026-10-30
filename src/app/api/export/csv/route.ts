import { NextRequest } from "next/server";
import { requireAuth, requirePermission, handleApiError } from "@/lib/utils/api";
import { getExportData, getVehicleExportData, buildExportI18n } from "@/lib/services/export-service";
import { parseExportFilters } from "@/lib/utils/export-params";
import { formatTime, formatDate, dateSettingsFromConfig } from "@/lib/utils/dates";
import { getConfigValues } from "@/lib/services/config-service";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(";") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}



export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "export:use");

    // Load date/time format config for server-side formatting
    // (passed explicitly: no global state on the server)
    const dates = dateSettingsFromConfig(await getConfigValues(["PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE"]));

    const locale = await resolveRequestLocale();
    const t = await getServerTranslator(locale);
    const i18n = buildExportI18n(t, locale);

    const filters = parseExportFilters(request.nextUrl.searchParams);
    const isVehicleMode = filters.viewMode === "vehicles";
    const data = isVehicleMode
      ? await getVehicleExportData(filters, session.user.name, i18n)
      : await getExportData(filters, session.user.name, i18n);

    const headers = isVehicleMode
      ? [
          t("exportFiles.columns.title"), t("exportFiles.columns.project"), t("exportFiles.columns.vehicle"),
          t("exportFiles.columns.vehicleType"), t("exportFiles.columns.assignmentType"),
          t("exportFiles.columns.startDate"), t("exportFiles.columns.endDate"),
          t("exportFiles.columns.startTime"), t("exportFiles.columns.endTime"),
          t("exportFiles.columns.assignedBy"), t("exportFiles.columns.notes"),
        ]
      : [
          t("exportFiles.columns.title"), t("exportFiles.columns.project"),
          t("exportFiles.columns.startDate"), t("exportFiles.columns.endDate"),
          t("exportFiles.columns.startTime"), t("exportFiles.columns.endTime"),
          t("exportFiles.columns.assignees"), t("exportFiles.columns.status"),
          t("exportFiles.columns.place"), t("exportFiles.columns.resource"),
          t("exportFiles.columns.notes"), t("exportFiles.columns.milestone"), t("exportFiles.columns.link"),
        ];

    const rows = data.tasks.map(task => isVehicleMode
      ? [
          escapeCSV(task.title),
          escapeCSV(task.project?.name),
          escapeCSV(task.vehicleName),
          escapeCSV(task.vehicleTypeName),
          escapeCSV(task.assignmentType ? i18n.assignmentTypeLabel(task.assignmentType) : task.assignmentType),
          escapeCSV(formatDate(task.startDate, locale, dates.dateFormat)),
          escapeCSV(task.endDate ? formatDate(task.endDate, locale, dates.dateFormat) : ""),
          escapeCSV(formatTime(task.startTime, locale, dates.timeFormat)),
          escapeCSV(formatTime(task.endTime, locale, dates.timeFormat)),
          escapeCSV(task.users.map(u => u.name).join(", ")),
          escapeCSV(task.notes),
        ]
      : [
          escapeCSV(task.title),
          escapeCSV(task.project?.name),
          escapeCSV(formatDate(task.startDate, locale, dates.dateFormat)),
          escapeCSV(task.endDate ? formatDate(task.endDate, locale, dates.dateFormat) : ""),
          escapeCSV(formatTime(task.startTime, locale, dates.timeFormat)),
          escapeCSV(formatTime(task.endTime, locale, dates.timeFormat)),
          escapeCSV(task.users.map(u => u.name).join(", ")),
          escapeCSV(task.status?.name),
          escapeCSV(task.place?.name),
          escapeCSV(task.resource?.name),
          escapeCSV(task.notes),
          escapeCSV(task.isMilestone ? t("common.boolean.yes") : t("common.boolean.no")),
          escapeCSV(task.link),
        ]);

    const csv = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\r\n");
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const prefix = isVehicleMode ? "vehicules" : "planning";

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${prefix}_${today}.csv"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
