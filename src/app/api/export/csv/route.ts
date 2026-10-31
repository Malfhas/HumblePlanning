import { NextRequest } from "next/server";
import { requireAuth, requirePermission, handleApiError } from "@/lib/utils/api";
import { getExportData, getVehicleExportData, buildExportI18n } from "@/lib/services/export-service";
import { parseExportFilters } from "@/lib/utils/export-params";
import { formatTime, formatDate, dateSettingsFromConfig } from "@/lib/utils/dates";
import { getConfigValues } from "@/lib/services/config-service";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";
import { escapeCsvCell } from "@/lib/utils/csv";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "export:use");

    // Load date/time format config for server-side formatting
    // (passed explicitly: no global state on the server)
    const dates = dateSettingsFromConfig(await getConfigValues(["PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE"]));

    const locale = await resolveRequestLocale();
    const t = await getServerTranslator(locale);
    const i18n = buildExportI18n(t, locale);

    const filters = parseExportFilters(request.nextUrl.searchParams);
    const isVehicleMode = filters.viewMode === "vehicles";
    const data = isVehicleMode
      ? await getVehicleExportData(filters, session.user.name, i18n, perms)
      : await getExportData(filters, session.user.name, i18n, perms);

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
          escapeCsvCell(task.title),
          escapeCsvCell(task.project?.name),
          escapeCsvCell(task.vehicleName),
          escapeCsvCell(task.vehicleTypeName),
          escapeCsvCell(task.assignmentType ? i18n.assignmentTypeLabel(task.assignmentType) : task.assignmentType),
          escapeCsvCell(formatDate(task.startDate, locale, dates.dateFormat)),
          escapeCsvCell(task.endDate ? formatDate(task.endDate, locale, dates.dateFormat) : ""),
          escapeCsvCell(formatTime(task.startTime, locale, dates.timeFormat)),
          escapeCsvCell(formatTime(task.endTime, locale, dates.timeFormat)),
          escapeCsvCell(task.users.map(u => u.name).join(", ")),
          escapeCsvCell(task.notes),
        ]
      : [
          escapeCsvCell(task.title),
          escapeCsvCell(task.project?.name),
          escapeCsvCell(formatDate(task.startDate, locale, dates.dateFormat)),
          escapeCsvCell(task.endDate ? formatDate(task.endDate, locale, dates.dateFormat) : ""),
          escapeCsvCell(formatTime(task.startTime, locale, dates.timeFormat)),
          escapeCsvCell(formatTime(task.endTime, locale, dates.timeFormat)),
          escapeCsvCell(task.users.map(u => u.name).join(", ")),
          escapeCsvCell(task.status?.name),
          escapeCsvCell(task.place?.name),
          escapeCsvCell(task.resource?.name),
          escapeCsvCell(task.notes),
          escapeCsvCell(task.isMilestone ? t("common.boolean.yes") : t("common.boolean.no")),
          escapeCsvCell(task.link),
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
