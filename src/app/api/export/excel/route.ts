import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth, requirePermission, handleApiError } from "@/lib/utils/api";
import { getExportData, getVehicleExportData, getProjectStatsForExport, getTasksForRowAndDay, buildExportI18n, shortDayName, type ExportTask, type ExportStatsData } from "@/lib/services/export-service";
import { parseExportFilters, type CellContent } from "@/lib/utils/export-params";
import { getConfigValue, getConfigValues } from "@/lib/services/config-service";
import { formatTime, formatDate, dateSettingsFromConfig, type DateSettings } from "@/lib/utils/dates";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, type ServerTranslator } from "@/i18n/server-translator";
import { INTL_TAG, type AppLocale } from "@/i18n/config";

function getISOWeekNumber(dateStr: string): number {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}



function hexToArgb(hex: string | null | undefined): string {
  if (!hex) return "FFFFFFFF";
  const clean = hex.replace("#", "");
  return `FF${clean}`;
}

function lightenColor(hex: string | null | undefined): string {
  if (!hex) return "FFF5F5F5";
  const clean = hex.replace("#", "");
  const r = Math.min(255, parseInt(clean.slice(0, 2), 16) + 60);
  const g = Math.min(255, parseInt(clean.slice(2, 4), 16) + 60);
  const b = Math.min(255, parseInt(clean.slice(4, 6), 16) + 60);
  return `FF${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function contrastArgb(hex: string | null | undefined): string {
  if (!hex) return "FF000000";
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "FF000000" : "FFFFFFFF";
}

function contrastArgbFromLightened(hex: string): string {
  const clean = hex.replace("#", "");
  const r = Math.min(255, parseInt(clean.slice(0, 2), 16) + 60);
  const g = Math.min(255, parseInt(clean.slice(2, 4), 16) + 60);
  const b = Math.min(255, parseInt(clean.slice(4, 6), 16) + 60);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "FF000000" : "FFFFFFFF";
}

function getCellText(task: ExportTask, cellContent: CellContent): string {
  switch (cellContent) {
    case "title": return task.title || "";
    case "user-name": return task.users.map(u => u.name).join(", ");
    case "user-login": return task.users.map(u => u.username || u.name).join(", ");
    case "project":
    default: return task.project?.name || "";
  }
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};

function fmtHours(n: number, locale: AppLocale): string {
  if (!Number.isFinite(n) || n === 0) return "0 h";
  return `${n.toLocaleString(INTL_TAG[locale], { maximumFractionDigits: 2 })} h`;
}

function buildStatsWorksheet(
  workbook: ExcelJS.Workbook,
  stats: ExportStatsData,
  startDate: string,
  endDate: string,
  tr: ServerTranslator,
  locale: AppLocale,
  dates: DateSettings,
): void {
  const ws = workbook.addWorksheet(tr("exportFiles.excel.sheets.stats"));
  const hrs = (n: number) => fmtHours(n, locale);

  // Title row
  ws.mergeCells(1, 1, 1, 7);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = tr("exportFiles.stats.title", { start: formatDate(startDate, locale, dates.dateFormat), end: formatDate(endDate, locale, dates.dateFormat) });
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } };
  titleCell.font = { size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).height = 22;

  // Summary row — period totals (big picture)
  ws.mergeCells(2, 1, 2, 7);
  const summaryCell = ws.getCell(2, 1);
  const t = stats.totals;
  summaryCell.value =
    `${tr("exportFiles.stats.counts", { projects: t.totalProjects, users: t.totalUsers, tasks: t.totalTasks })} · ` +
    tr("exportFiles.stats.periodHours", { total: hrs(t.totalHours), consumed: hrs(t.consumedHours), upcoming: hrs(t.upcomingHours) });
  summaryCell.font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
  summaryCell.alignment = { horizontal: "center" };

  // ── Section 1: Hours per project (over the period) ──
  let row = 4;
  const section1Title = ws.getCell(row, 1);
  section1Title.value = tr("exportFiles.stats.sections.periodHours");
  section1Title.font = { size: 11, bold: true };
  ws.mergeCells(row, 1, row, 7);
  row++;

  const headers1 = [
    tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.group"), tr("exportFiles.stats.columns.totalHours"),
    tr("exportFiles.stats.columns.consumedHours"), tr("exportFiles.stats.columns.upcoming"), tr("exportFiles.stats.columns.tasks"),
    tr("exportFiles.stats.columns.users"),
  ];
  headers1.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "center" };
    cell.border = THIN_BORDER;
  });
  row++;

  for (const p of stats.projects) {
    const cells = [
      p.projectName,
      p.groupName || "—",
      hrs(p.totalHours),
      hrs(p.consumedHours),
      hrs(p.upcomingHours),
      p.taskCount,
      p.userCount,
    ];
    cells.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = v;
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: i === 0 || i === 1 ? "left" : "right", vertical: "middle" };
    });
    // Project color dot on first cell
    if (p.projectColor) {
      const cell = ws.getCell(row, 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightenColor(p.projectColor) } };
    }
    row++;
  }

  // Total row — section 1
  if (stats.projects.length > 0) {
    const totalCells = [
      tr("exportFiles.stats.totalPeriod"),
      "",
      hrs(t.totalHours),
      hrs(t.consumedHours),
      hrs(t.upcomingHours),
      t.totalTasks,
      t.totalUsers,
    ];
    totalCells.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = v;
      cell.border = THIN_BORDER;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDD6FE" } };
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: i === 0 || i === 1 ? "left" : "right", vertical: "middle" };
    });
    row++;
  }
  row += 2;

  // ── Section 2: User time × projects (over the period) ──
  if (stats.usersByProject.length > 0) {
    const section2Title = ws.getCell(row, 1);
    section2Title.value = tr("exportFiles.stats.sections.usersByProject");
    section2Title.font = { size: 11, bold: true };
    ws.mergeCells(row, 1, row, 7);
    row++;

    const headers2 = [
      tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.user"), tr("exportFiles.stats.columns.laborType"),
      tr("exportFiles.stats.columns.hours"), "", "", "",
    ];
    headers2.forEach((h, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = h;
      if (h) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
        cell.font = { bold: true, size: 10 };
        cell.border = THIN_BORDER;
      }
      cell.alignment = { horizontal: "center" };
    });
    row++;

    // Group by project with sub-totals
    const groupedByProject = new Map<string, typeof stats.usersByProject>();
    for (const u of stats.usersByProject) {
      const list = groupedByProject.get(u.projectId) ?? [];
      list.push(u);
      groupedByProject.set(u.projectId, list);
    }

    for (const [, userList] of groupedByProject) {
      for (const u of userList) {
        const cells = [u.projectName, u.userName, u.laborTypeName || "—", hrs(u.hours)];
        cells.forEach((v, i) => {
          const cell = ws.getCell(row, i + 1);
          cell.value = v;
          cell.border = THIN_BORDER;
          cell.alignment = { horizontal: i < 3 ? "left" : "right", vertical: "middle" };
        });
        if (u.projectColor) {
          const cell = ws.getCell(row, 1);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightenColor(u.projectColor) } };
        }
        row++;
      }
      // Sub-total per project
      const subTotal = userList.reduce((s, u) => s + u.hours, 0);
      const subCells = [`  └ ${tr("exportFiles.stats.subtotal", { project: userList[0]?.projectName ?? "" })}`, "", "", hrs(Math.round(subTotal * 100) / 100)];
      subCells.forEach((v, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = v;
        cell.border = THIN_BORDER;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        cell.font = { italic: true, size: 9, color: { argb: "FF4B5563" } };
        cell.alignment = { horizontal: i < 3 ? "left" : "right", vertical: "middle" };
      });
      row++;
    }

    // Grand total section 2
    const grandTotalUsersHours = stats.usersByProject.reduce((s, u) => s + u.hours, 0);
    const totalCells2 = [tr("exportFiles.stats.totalPeriod"), "", "", hrs(Math.round(grandTotalUsersHours * 100) / 100)];
    totalCells2.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = v;
      cell.border = THIN_BORDER;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDD6FE" } };
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: i < 3 ? "left" : "right", vertical: "middle" };
    });
    row++;
    row += 2;
  }

  // ── Section 3: Labor budgets (lifetime, not restricted to the period) ──
  const projectsWithBudgets = stats.projects.filter((p) => p.budgets.length > 0);
  if (projectsWithBudgets.length > 0) {
    const section3Title = ws.getCell(row, 1);
    section3Title.value = tr("exportFiles.stats.sections.budgets");
    section3Title.font = { size: 11, bold: true };
    ws.mergeCells(row, 1, row, 7);
    row++;

    const headers3 = [
      tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.laborType"), tr("exportFiles.stats.columns.budgetHours"),
      tr("exportFiles.stats.columns.consumed"), tr("exportFiles.stats.columns.upcoming"), tr("exportFiles.stats.columns.remaining"),
      tr("exportFiles.stats.columns.progress"),
    ];
    headers3.forEach((h, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = h;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center" };
      cell.border = THIN_BORDER;
    });
    row++;

    for (const p of projectsWithBudgets) {
      for (const b of p.budgets) {
        const used = b.totalConsumed + b.totalUpcoming;
        const progress = b.plannedHours > 0 ? Math.round((used / b.plannedHours) * 100) : 0;
        const cells = [
          p.projectName,
          `${b.laborTypeName} (${b.laborTypeInitials})`,
          hrs(b.plannedHours),
          hrs(b.totalConsumed),
          hrs(b.totalUpcoming),
          hrs(b.remaining),
          `${progress}%`,
        ];
        cells.forEach((v, i) => {
          const cell = ws.getCell(row, i + 1);
          cell.value = v;
          cell.border = THIN_BORDER;
          cell.alignment = { horizontal: i < 2 ? "left" : "right", vertical: "middle" };
        });
        if (p.projectColor) {
          const cell = ws.getCell(row, 1);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightenColor(p.projectColor) } };
        }
        // Red tint on "Restant" when negative
        if (b.remaining < 0) {
          const remainCell = ws.getCell(row, 6);
          remainCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
          remainCell.font = { color: { argb: "FFB91C1C" }, bold: true };
        }
        row++;
      }
    }

    // Grand total budget
    const bt = stats.budgetTotals;
    const budgetUsed = bt.lifetimeConsumed + bt.lifetimeUpcoming;
    const budgetProgress = bt.plannedHours > 0 ? Math.round((budgetUsed / bt.plannedHours) * 100) : 0;
    const totalCells3 = [
      tr("exportFiles.stats.totalProjects"),
      "",
      hrs(bt.plannedHours),
      hrs(bt.lifetimeConsumed),
      hrs(bt.lifetimeUpcoming),
      hrs(bt.remaining),
      `${budgetProgress}%`,
    ];
    totalCells3.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = v;
      cell.border = THIN_BORDER;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDD6FE" } };
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: i < 2 ? "left" : "right", vertical: "middle" };
    });
    if (bt.remaining < 0) {
      const remainCell = ws.getCell(row, 6);
      remainCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
      remainCell.font = { color: { argb: "FFB91C1C" }, bold: true };
    }
    row++;
  }

  // Column widths
  const statsColWidths = [32, 22, 15, 15, 15, 15, 14];
  statsColWidths.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
}

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
    const fmt = (d: string, pattern?: string) => formatDate(d, locale, pattern ?? dates.dateFormat);

    const filters = parseExportFilters(request.nextUrl.searchParams);
    // Default: projects view → user names, other views → project name
    const defaultContent = filters.viewMode === "projects" ? "user-name" : "project";
    const cellContent: CellContent = filters.cellContent || defaultContent;

    // Dispatch data fetching based on calendar mode
    const isVehicleMode = filters.viewMode === "vehicles";
    const data = isVehicleMode
      ? await getVehicleExportData(filters, session.user.name, i18n, perms)
      : await getExportData(filters, session.user.name, i18n, perms);

    const workbook = new ExcelJS.Workbook();
    const totalCols = 1 + data.dateRange.days.length;

    // === Sheet 1: Planning (Gantt view) ===
    const wsGantt = workbook.addWorksheet(t("exportFiles.excel.sheets.planning"));

    // Row 1: Merged header — adapt title to calendar mode
    const appTitle = await getConfigValue("APP_TITLE") || "HumblePlanning";
    const range = { start: fmt(filters.startDate), end: fmt(filters.endDate) };
    let headerTitle: string;
    if (filters.calendarMode === "personal" && filters.calendarUserId) {
      const userRow = data.rows.find(r => r.id === filters.calendarUserId);
      headerTitle = userRow
        ? t("exportFiles.excel.titles.personal", { name: userRow.label, ...range })
        : t("exportFiles.excel.titles.personalUnknown", range);
    } else if (filters.calendarMode === "team-day" && filters.selectedDay) {
      headerTitle = t("exportFiles.excel.titles.teamDay", { appTitle, date: fmt(filters.selectedDay) });
    } else if (isVehicleMode) {
      headerTitle = t("exportFiles.excel.titles.vehicles", { appTitle, ...range });
    } else {
      headerTitle = t("exportFiles.excel.titles.default", { appTitle, ...range });
    }
    wsGantt.mergeCells(1, 1, 1, totalCols);
    const titleCell = wsGantt.getCell(1, 1);
    titleCell.value = headerTitle;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: "center" };
    titleCell.border = THIN_BORDER;

    // Row 2: Week numbers (merged across days of same week)
    const weekLabelCell = wsGantt.getCell(2, 1);
    weekLabelCell.value = "";
    weekLabelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
    weekLabelCell.border = THIN_BORDER;

    // Group consecutive days by week number for merging
    const weekSpans: { week: number; startCol: number; endCol: number }[] = [];
    data.dateRange.days.forEach((day, i) => {
      const wn = getISOWeekNumber(day);
      const col = i + 2;
      if (weekSpans.length > 0 && weekSpans[weekSpans.length - 1].week === wn) {
        weekSpans[weekSpans.length - 1].endCol = col;
      } else {
        weekSpans.push({ week: wn, startCol: col, endCol: col });
      }
    });

    weekSpans.forEach(({ week, startCol, endCol }) => {
      if (startCol < endCol) {
        wsGantt.mergeCells(2, startCol, 2, endCol);
      }
      const cell = wsGantt.getCell(2, startCol);
      cell.value = t("exportFiles.common.weekLabel", { week });
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
      cell.font = { size: 9, bold: true };
      cell.alignment = { horizontal: "center" };
      cell.border = THIN_BORDER;
      // Borders on all cells of merged range
      for (let c = startCol; c <= endCol; c++) {
        wsGantt.getCell(2, c).border = THIN_BORDER;
      }
    });

    // Row 3: Day names
    const dayNameCell = wsGantt.getCell(3, 1);
    dayNameCell.value = "";
    dayNameCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    dayNameCell.border = THIN_BORDER;

    data.dateRange.days.forEach((day, i) => {
      const d = new Date(day);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const holiday = data.holidays.get(day);
      const cell = wsGantt.getCell(3, i + 2);
      cell.value = shortDayName(day, locale);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: holiday ? hexToArgb(holiday.color) : isWeekend ? "FFDCDCE6" : "FFE5E7EB" } };
      cell.font = { size: 9, color: holiday ? { argb: contrastArgb(holiday.color) } : undefined };
      cell.alignment = { horizontal: "center" };
      cell.border = THIN_BORDER;
    });

    // Row 4: Dates
    const dateHeaderCell = wsGantt.getCell(4, 1);
    dateHeaderCell.value = "";
    dateHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    dateHeaderCell.border = THIN_BORDER;

    data.dateRange.days.forEach((day, i) => {
      const d = new Date(day);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const holiday = data.holidays.get(day);
      const cell = wsGantt.getCell(4, i + 2);
      cell.value = fmt(day, "dd/MM");
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: holiday ? hexToArgb(holiday.color) : isWeekend ? "FFDCDCE6" : "FFE5E7EB" } };
      cell.font = { size: 9, color: holiday ? { argb: contrastArgb(holiday.color) } : undefined };
      cell.alignment = { horizontal: "center" };
      cell.border = THIN_BORDER;
    });

    // Data rows (with header/separator support)
    let excelRowIdx = 5;
    for (const row of data.rows) {
      if (row.type === "header") {
        // Team/group separator row — merged, colored
        wsGantt.mergeCells(excelRowIdx, 1, excelRowIdx, totalCols);
        const headerCell = wsGantt.getCell(excelRowIdx, 1);
        headerCell.value = row.label;
        headerCell.font = { bold: true, size: 10, color: { argb: contrastArgb(row.color) } };
        headerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(row.color) } };
        headerCell.alignment = { horizontal: "left", vertical: "middle" };
        // Apply border to all cells in merged range
        for (let col = 1; col <= totalCols; col++) {
          wsGantt.getCell(excelRowIdx, col).border = THIN_BORDER;
        }
        excelRowIdx++;
        continue;
      }

      // Normal data row
      const nameCell = wsGantt.getCell(excelRowIdx, 1);
      nameCell.value = row.label;
      nameCell.font = { bold: true, size: 10, color: row.color ? { argb: contrastArgbFromLightened(row.color) } : undefined };
      nameCell.border = THIN_BORDER;
      if (row.color) {
        nameCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightenColor(row.color) } };
      }

      data.dateRange.days.forEach((day, colIdx) => {
        const cell = wsGantt.getCell(excelRowIdx, colIdx + 2);
        cell.border = THIN_BORDER;

        const holiday = data.holidays.get(day);
        if (holiday) {
          // Holiday: fill with holiday label and color for all rows
          cell.value = holiday.label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(holiday.color) } };
          cell.font = { size: 8, color: { argb: contrastArgb(holiday.color) } };
          cell.alignment = { wrapText: true };
        } else {
          const dayTasks = getTasksForRowAndDay(data, row.id, day);
          if (dayTasks.length > 0) {
            cell.value = dayTasks.map(t => getCellText(t, cellContent)).join(", ");
            const projectColor = dayTasks[0].project?.color;
            cell.font = { size: 8, color: projectColor && projectColor.toLowerCase() !== "#ffffff" ? { argb: contrastArgb(projectColor) } : undefined };
            cell.alignment = { wrapText: true };
            if (projectColor && projectColor.toLowerCase() !== "#ffffff") {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(projectColor) } };
            }
          } else {
            const d = new Date(day);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            if (isWeekend) {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBEBF5" } };
            }
          }
        }
      });

      excelRowIdx++;
    }

    // Column widths
    wsGantt.getColumn(1).width = 25;
    for (let i = 2; i <= totalCols; i++) {
      wsGantt.getColumn(i).width = 12;
    }

    // Freeze panes
    wsGantt.views = [{ state: "frozen", xSplit: 1, ySplit: 4 }];

    // === Sheet 2: Task List ===
    const wsList = workbook.addWorksheet(isVehicleMode ? t("exportFiles.excel.sheets.assignments") : t("exportFiles.excel.sheets.tasks"));

    const listHeaders = isVehicleMode
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
          t("exportFiles.columns.notes"), t("exportFiles.columns.milestone"),
        ];

    const headerRow = wsList.addRow(listHeaders);
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.alignment = { horizontal: "center" };
      cell.border = THIN_BORDER;
    });

    data.tasks.forEach((task, idx) => {
      const rowValues = isVehicleMode
        ? [
            task.title ?? "",
            task.project?.name ?? "",
            task.vehicleName ?? "",
            task.vehicleTypeName ?? "",
            task.assignmentType ? i18n.assignmentTypeLabel(task.assignmentType) : "",
            fmt(task.startDate),
            task.endDate ? fmt(task.endDate) : "",
            formatTime(task.startTime, locale, dates.timeFormat),
            formatTime(task.endTime, locale, dates.timeFormat),
            task.users.map(u => u.name).join(", "),
            task.notes ?? "",
          ]
        : [
            task.title ?? "",
            task.project?.name ?? "",
            fmt(task.startDate),
            task.endDate ? fmt(task.endDate) : "",
            formatTime(task.startTime, locale, dates.timeFormat),
            formatTime(task.endTime, locale, dates.timeFormat),
            task.users.map(u => u.name).join(", "),
            task.status?.name ?? "",
            task.place?.name ?? "",
            task.resource?.name ?? "",
            task.notes ?? "",
            task.isMilestone ? t("common.boolean.yes") : t("common.boolean.no"),
          ];

      const row = wsList.addRow(rowValues);

      for (let col = 1; col <= listHeaders.length; col++) {
        const cell = row.getCell(col);
        cell.border = THIN_BORDER;
        if (idx % 2 === 1 && !cell.fill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
        }
      }

      // Project color
      if (task.project?.color) {
        const projectCell = row.getCell(2);
        projectCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightenColor(task.project.color) } };
        projectCell.font = { ...projectCell.font, color: { argb: contrastArgbFromLightened(task.project.color) } };
      }

      // Status styling
      if (task.status) {
        const statusCell = row.getCell(8);
        statusCell.font = {
          bold: task.status.bold ?? false,
          italic: task.status.italic ?? false,
          strike: task.status.strikethrough ?? false,
          underline: task.status.underline ? "single" : undefined,
          color: task.status.color ? { argb: hexToArgb(task.status.color) } : undefined,
        };
      }
    });

    wsList.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: data.tasks.length + 1, column: listHeaders.length },
    };

    const colWidths = isVehicleMode
      ? [25, 20, 18, 15, 15, 12, 12, 10, 10, 20, 30]
      : [25, 20, 12, 12, 10, 10, 25, 12, 15, 15, 30, 8];
    colWidths.forEach((width, i) => {
      wsList.getColumn(i + 1).width = width;
    });

    // === Sheet 3 (optional): Project / user stats ===
    if (filters.includeStats && !isVehicleMode) {
      const stats = await getProjectStatsForExport(filters, i18n, perms);
      buildStatsWorksheet(workbook, stats, filters.startDate, filters.endDate, t, locale, dates);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="planning_${today}.xlsx"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
