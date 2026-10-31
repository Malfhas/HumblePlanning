import { NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { requireAuth, requirePermission, handleApiError } from "@/lib/utils/api";
import { formatDate, formatDateTime, formatTime, formatHourLabel, dateSettingsFromConfig, type DateSettings } from "@/lib/utils/dates";
import { getConfigValues } from "@/lib/services/config-service";
import { getExportData, getVehicleExportData, getProjectStatsForExport, getTasksForRowAndDay, buildExportI18n, shortDayName, longDayLabel, type ExportData, type ExportTask, type ExportStatsData } from "@/lib/services/export-service";
import { parseExportFilters, type CellContent } from "@/lib/utils/export-params";
import { getConfigValue } from "@/lib/services/config-service";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, translateKey, type ServerTranslator } from "@/i18n/server-translator";
import { INTL_TAG, type AppLocale } from "@/i18n/config";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";

// i18n-dynamic: exportFiles.pdf.cover.formats.*
// i18n-dynamic: exportFiles.pdf.cover.views.*
// i18n-dynamic: exportFiles.pdf.cover.cellContents.*
// i18n-dynamic: exportFiles.pdf.cover.sortModes.*

/** kebab-case identifier (`custom-bu-team`) → camelCase key segment (`customBuTeam`). */
const keySegment = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const PAGE_SIZES: Record<string, [number, number]> = {
  A0: [2383.94, 3370.39],
  A1: [1683.78, 2383.94],
  A2: [1190.55, 1683.78],
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
};



function getCellText(task: ExportTask, cellContent: CellContent): string {
  switch (cellContent) {
    case "title": return task.title || "";
    case "user-name": return task.users.map(u => u.name).join(", ");
    case "user-login": return task.users.map(u => u.username || u.name).join(", ");
    case "project":
    default: return task.project?.name || "";
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lightenRgb(hex: string | null): [number, number, number] | null {
  if (!hex) return null;
  const [r, g, b] = hexToRgb(hex);
  return [Math.min(255, r + 60), Math.min(255, g + 60), Math.min(255, b + 60)];
}

function contrastColor(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
}

function contrastRgb(rgb: [number, number, number]): [number, number, number] {
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
}

function pdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// ── Page helper ──

interface PageContext {
  doc: PDFKit.PDFDocument;
  w: number;
  h: number;
  titleText: string;
  pageNum: number;
  /** Export language (request language) and associated translator. */
  locale: AppLocale;
  t: ServerTranslator;
  /** Instance date settings (pattern, 24 h / 12 h, time zone). */
  dates: DateSettings;
}

const CONTENT_TOP = 50;
const FOOTER_ZONE = 30;

function drawPageHeader(ctx: PageContext) {
  const { doc, w, titleText } = ctx;
  doc.save();
  doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
  doc.text(titleText, 20, 15, { width: w - 40, align: "center", lineBreak: false });
  doc.restore();
}

function newPage(ctx: PageContext): number {
  ctx.doc.addPage();
  ctx.pageNum++;
  drawPageHeader(ctx);
  return CONTENT_TOP;
}

// ── Load logo as PNG buffer (pdfkit only supports PNG/JPEG) ──

async function loadLogoPng(): Promise<Buffer | null> {
  // The PDF has a light background: prefer the light variant of the logo.
  const logoPath = (await getConfigValue("APP_LOGO_LIGHT")) || (await getConfigValue("APP_LOGO"));
  if (!logoPath?.startsWith("branding/")) return null;
  // Same resolution as /api/branding: file uploaded by the admin, otherwise
  // default asset shipped with the code (public/branding-defaults/).
  const fileName = basename(logoPath);
  const candidates = [
    join(process.cwd(), "uploads", "branding", fileName),
    join(process.cwd(), "public", "branding-defaults", fileName),
  ];
  for (const fullPath of candidates) {
    try {
      const buf = await readFile(fullPath);
      // Convert to PNG (pdfkit doesn't support AVIF/WebP/SVG)
      return await sharp(buf, { density: 300 }).png().toBuffer();
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ── Cover page ──

interface CoverInfo {
  appTitle: string;
  titleText: string;
  format: string;
  viewMode: string;
  sortMode?: string;
  cellContent: string;
  exportDate: string;
  filterCounts: { label: string; count: number }[];
}

function drawCoverPage(ctx: PageContext, logoPng: Buffer | null, info: CoverInfo) {
  const { doc, w, h } = ctx;
  doc.addPage();
  ctx.pageNum++;

  let y = h * 0.15;

  // Logo
  if (logoPng) {
    try {
      const logoW = 120;
      const logoH = 120;
      doc.image(logoPng, (w - logoW) / 2, y, { fit: [logoW, logoH], align: "center", valign: "center" });
      y += logoH + 30;
    } catch {
      y += 30;
    }
  }

  // App title
  doc.save();
  doc.font("Helvetica-Bold").fontSize(28).fillColor([30, 30, 30]);
  doc.text(info.appTitle, 40, y, { width: w - 80, align: "center" });
  y += 45;

  // Subtitle
  doc.font("Helvetica").fontSize(16).fillColor([80, 80, 80]);
  doc.text(info.titleText, 40, y, { width: w - 80, align: "center" });
  y += 50;

  // Separator line
  doc.moveTo(w * 0.3, y).lineTo(w * 0.7, y).lineWidth(1).strokeColor([180, 180, 180]).stroke();
  y += 30;

  const { t } = ctx;

  // Summary section
  doc.font("Helvetica-Bold").fontSize(12).fillColor([50, 50, 50]);
  doc.text(t("exportFiles.pdf.cover.summaryTitle"), 40, y, { width: w - 80, align: "center" });
  y += 25;

  doc.font("Helvetica").fontSize(10).fillColor([80, 80, 80]);
  // Unknown value (free URL parameter): displayed as is.
  const label = (group: string, id: string) => translateKey(t, `exportFiles.pdf.cover.${group}.${keySegment(id)}`) ?? id;

  const summaryLines = [
    t("exportFiles.pdf.cover.format", { value: label("formats", info.format) }),
    t("exportFiles.pdf.cover.view", { value: label("views", info.viewMode) }),
    t("exportFiles.pdf.cover.cellContent", { value: label("cellContents", info.cellContent) }),
  ];
  if (info.sortMode) summaryLines.push(t("exportFiles.pdf.cover.sort", { value: label("sortModes", info.sortMode) }));
  summaryLines.push(t("exportFiles.pdf.cover.exportDate", { date: info.exportDate }));

  const summaryX = w * 0.3;
  for (const line of summaryLines) {
    doc.text(line, summaryX, y, { width: w * 0.4 });
    y += 16;
  }

  // Active filters
  const activeFilters = info.filterCounts.filter(f => f.count > 0);
  if (activeFilters.length > 0) {
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10).fillColor([50, 50, 50]);
    doc.text(t("exportFiles.pdf.cover.activeFilters"), summaryX, y);
    y += 16;
    doc.font("Helvetica").fontSize(10).fillColor([80, 80, 80]);
    for (const f of activeFilters) {
      doc.text(t("exportFiles.pdf.cover.filterCount", { label: f.label, count: f.count }), summaryX + 10, y);
      y += 14;
    }
  }

  doc.restore();
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "export:use");
    const params = request.nextUrl.searchParams;
    const filters = parseExportFilters(params);

    // Load date format config for server-side formatting
    // (passed explicitly: no global state on the server)
    const dates = dateSettingsFromConfig(await getConfigValues(["PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE"]));

    const paperSize = params.get("paperSize") || "A4";
    const orientation = (params.get("orientation") || "landscape") as "portrait" | "landscape";
    const format = params.get("format") || "gantt";

    const defaultContent = filters.viewMode === "projects" ? "user-name" : "project";
    const cellContent: CellContent = filters.cellContent || defaultContent;

    const locale = await resolveRequestLocale();
    const t = await getServerTranslator(locale);
    const i18n = buildExportI18n(t, locale);
    const fmt = (d: string | Date) => formatDate(d, locale, dates.dateFormat);

    // Dispatch data fetching based on calendar mode
    const isVehicleMode = filters.viewMode === "vehicles";
    const data = isVehicleMode
      ? await getVehicleExportData(filters, session.user.name, i18n)
      : await getExportData(filters, session.user.name, i18n, perms);

    const size = PAGE_SIZES[paperSize] || PAGE_SIZES.A4;
    const [w, h] = orientation === "landscape" ? [size[1], size[0]] : size;

    const doc = new PDFDocument({
      size: [w, h],
      margins: { top: CONTENT_TOP, bottom: FOOTER_ZONE, left: 20, right: 20 },
      autoFirstPage: false,
      bufferPages: true,
    });

    // Adapt title based on calendar mode
    const range = { start: fmt(filters.startDate), end: fmt(filters.endDate) };
    let titleText: string;
    if (filters.calendarMode === "personal" && filters.calendarUserId) {
      const userRow = data.rows.find(r => r.id === filters.calendarUserId);
      titleText = userRow
        ? t("exportFiles.pdf.titles.personal", { name: userRow.label, ...range })
        : t("exportFiles.pdf.titles.personalUnknown", range);
    } else if (filters.calendarMode === "team-day" && filters.selectedDay) {
      titleText = t("exportFiles.pdf.titles.teamDay", { date: fmt(filters.selectedDay) });
    } else if (isVehicleMode) {
      titleText = t("exportFiles.pdf.titles.vehicles", range);
    } else {
      titleText = t("exportFiles.pdf.titles.default", range);
    }
    const ctx: PageContext = { doc, w, h, titleText, pageNum: 0, locale, t, dates };

    // ── Cover page ──
    const [logoPng, appTitle] = await Promise.all([
      loadLogoPng(),
      getConfigValue("APP_TITLE").then(v => v || "HumblePlanning"),
    ]);

    const coverInfo: CoverInfo = {
      appTitle,
      titleText,
      format,
      viewMode: filters.viewMode,
      sortMode: filters.sortMode,
      cellContent,
      exportDate: formatDateTime(new Date(), locale, dates),
      filterCounts: [
        { label: t("exportFiles.pdf.cover.filters.teams"), count: filters.teamIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.users"), count: filters.userIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.projects"), count: filters.projectIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.statuses"), count: filters.statusIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.places"), count: filters.placeIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.resources"), count: filters.resourceIds?.length ?? 0 },
      ],
    };
    drawCoverPage(ctx, logoPng, coverInfo);

    // ── Content pages ──
    doc.addPage();
    ctx.pageNum++;
    drawPageHeader(ctx);

    const fitOnePage = params.get("fitOnePage") === "1";
    const calendarView = params.get("calendarView") || "hours";

    if (format === "calendar") {
      const [amStart, pmEnd] = await Promise.all([
        getConfigValue("AM_START").then(v => v || "08:00"),
        getConfigValue("PM_END").then(v => v || "17:00"),
      ]);
      const workStart = parseInt(amStart.split(":")[0], 10);
      const workEnd = parseInt(pmEnd.split(":")[0], 10);
      if (filters.calendarMode === "team-day") {
        drawCalendarTeamDayContent(ctx, data, workStart, workEnd);
      } else {
        drawCalendarContent(ctx, data, calendarView as "hours" | "days", workStart, workEnd);
      }
    } else if (format === "list") {
      drawListContent(ctx, data);
    } else {
      drawGanttContent(ctx, data, cellContent, fitOnePage);
    }

    // ── Optional: stats pages at the end ──
    if (filters.includeStats && !isVehicleMode) {
      const stats = await getProjectStatsForExport(filters, i18n, perms);
      drawStatsPages(ctx, stats);
    }

    // ── Post-processing: add "Page X / Y" footer on content pages (skip cover = page 0) ──
    const pageRange = doc.bufferedPageRange();
    const totalContentPages = pageRange.count - 1; // exclude cover
    const exportDateStr = fmt(new Date());

    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      if (i === 0) continue; // skip cover page

      doc.save();
      doc.font("Helvetica").fontSize(7).fillColor([120, 120, 120]);
      doc.text(t("exportFiles.pdf.footer.exportedOn", { date: exportDateStr }), 20, h - 18, { height: 10, lineBreak: false });
      doc.text(t("exportFiles.pdf.footer.page", { page: i, total: totalContentPages }), w - 90, h - 18, { width: 70, height: 10, align: "right", lineBreak: false });
      doc.restore();
    }

    const buffer = await pdfBuffer(doc);
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="planning_${today}.pdf"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// ── Gantt (grid) ──────────────────────────────────────────────

function getISOWeek(dateStr: string): number {
  const d = new Date(dateStr);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function drawGanttContent(ctx: PageContext, data: ExportData, cellContent: CellContent, fitOnePage = false) {
  const { doc, w, h } = ctx;
  const days = data.dateRange.days;
  const displayDays = fitOnePage ? days.slice(0, Math.min(days.length, 120)) : days;

  const margin = 20;
  const tableWidth = w - margin * 2;
  const nameColWidth = Math.min(120, tableWidth * 0.15);
  const weekHeaderHeight = 14;
  const dayHeaderHeight = 18;
  const totalHeaderHeight = weekHeaderHeight + dayHeaderHeight;
  const rowHeight = 16;
  const blockSpacing = 10;
  const maxY = h - FOOTER_ZONE - 5;

  const availableWidth = tableWidth - nameColWidth;

  if (fitOnePage) {
    // ── Fit everything on one single block ──
    const dayColWidth = availableWidth / displayDays.length;
    let y = CONTENT_TOP;
    y = drawGanttHeader(doc, margin, y, nameColWidth, dayColWidth, weekHeaderHeight, dayHeaderHeight, displayDays, data.holidays, ctx);
    for (const row of data.rows) {
      drawGanttRow(doc, margin, y, nameColWidth, dayColWidth, rowHeight, row, displayDays, data, cellContent, tableWidth);
      y += rowHeight;
    }
    return;
  }

  // ── Multi-block stacking: daysPerChunk based on paper size ──
  // A5/A4/A3 → 2 weeks (10d), A2 → 3 weeks (15d), A1 → 4 weeks (20d), A0 → 5 weeks (25d)
  const MAX_DAYS_PER_CHUNK = w >= 2384 ? 25 : w >= 1684 ? 20 : w >= 1190 ? 15 : 10;
  const daysPerChunk = Math.min(displayDays.length, MAX_DAYS_PER_CHUNK);

  // If all days fit comfortably, single block
  if (displayDays.length <= daysPerChunk) {
    const dayColWidth = availableWidth / displayDays.length;
    let y = CONTENT_TOP;
    y = drawGanttHeader(doc, margin, y, nameColWidth, dayColWidth, weekHeaderHeight, dayHeaderHeight, displayDays, data.holidays, ctx);
    for (const row of data.rows) {
      if (y + rowHeight > maxY) {
        y = newPage(ctx);
        y = drawGanttHeader(doc, margin, y, nameColWidth, dayColWidth, weekHeaderHeight, dayHeaderHeight, displayDays, data.holidays, ctx);
      }
      drawGanttRow(doc, margin, y, nameColWidth, dayColWidth, rowHeight, row, displayDays, data, cellContent, tableWidth);
      y += rowHeight;
    }
    return;
  }

  // ── Split days into chunks and stack vertically ──
  const dayChunks: string[][] = [];
  for (let i = 0; i < displayDays.length; i += daysPerChunk) {
    dayChunks.push(displayDays.slice(i, i + daysPerChunk));
  }

  // Height of one full block (header + all rows)
  const blockContentHeight = totalHeaderHeight + data.rows.length * rowHeight;

  let y = CONTENT_TOP;

  for (let chunkIdx = 0; chunkIdx < dayChunks.length; chunkIdx++) {
    const chunk = dayChunks[chunkIdx];
    const dayColWidth = availableWidth / chunk.length;

    // Check if this entire block fits on the current page
    // If not, start a new page
    if (chunkIdx > 0 && y + blockContentHeight > maxY) {
      y = newPage(ctx);
    }

    // Spacing between blocks (not before the first)
    if (chunkIdx > 0 && y > CONTENT_TOP) {
      y += blockSpacing;
    }

    // ── Week + Date header ──
    y = drawGanttHeader(doc, margin, y, nameColWidth, dayColWidth, weekHeaderHeight, dayHeaderHeight, chunk, data.holidays, ctx);

    // ── Data rows ──
    for (const row of data.rows) {
      if (y + rowHeight > maxY) {
        y = newPage(ctx);
        y = drawGanttHeader(doc, margin, y, nameColWidth, dayColWidth, weekHeaderHeight, dayHeaderHeight, chunk, data.holidays, ctx);
      }
      drawGanttRow(doc, margin, y, nameColWidth, dayColWidth, rowHeight, row, chunk, data, cellContent, tableWidth);
      y += rowHeight;
    }
  }
}

/** Draw a single Gantt row (header-type or data-type) */
function drawGanttRow(
  doc: PDFKit.PDFDocument,
  margin: number, y: number,
  nameColWidth: number, dayColWidth: number, rowHeight: number,
  row: ExportData["rows"][number],
  days: string[],
  data: ExportData,
  cellContent: CellContent,
  tableWidth: number,
) {
  if (row.type === "header") {
    const chunkTableWidth = nameColWidth + days.length * dayColWidth;
    const bg = row.color ? hexToRgb(row.color) : [107, 114, 128] as [number, number, number];
    const fg = row.color ? contrastColor(row.color) : [255, 255, 255] as [number, number, number];
    drawCell(doc, margin, y, chunkTableWidth, rowHeight, row.label, {
      bg, fg, fontSize: 8, bold: true,
    });
    return;
  }

  const nameBg = row.color ? lightenRgb(row.color) : null;
  const nameFg = nameBg ? contrastRgb(nameBg) : undefined;
  drawCell(doc, margin, y, nameColWidth, rowHeight, row.label, {
    bg: nameBg, fg: nameFg, fontSize: 7, bold: true,
  });

  days.forEach((day, i) => {
    const d = new Date(day);
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const holiday = data.holidays.get(day);

    let cellBg: [number, number, number] | null = null;
    let cellFg: [number, number, number] | undefined;
    let text = "";

    if (holiday) {
      // Holiday: fill all cells with holiday label and color
      text = holiday.label;
      cellBg = hexToRgb(holiday.color);
      cellFg = contrastColor(holiday.color);
    } else {
      const dayTasks = getTasksForRowAndDay(data, row.id, day);
      text = dayTasks.map(t => getCellText(t, cellContent)).join(", ");

      if (dayTasks.length > 0) {
        const projectColor = dayTasks[0].project?.color;
        if (projectColor && projectColor.toLowerCase() !== "#ffffff") {
          cellBg = hexToRgb(projectColor);
          cellFg = contrastColor(projectColor);
        }
      }

      if (!cellBg && isWeekend) {
        cellBg = [235, 235, 245];
      }
    }

    drawCell(doc, margin + nameColWidth + i * dayColWidth, y, dayColWidth, rowHeight,
      text, { bg: cellBg, fg: cellFg, fontSize: 5 });
  });
}

function drawGanttHeader(
  doc: PDFKit.PDFDocument,
  margin: number, y: number,
  nameColWidth: number, dayColWidth: number,
  weekHeaderHeight: number, dayHeaderHeight: number,
  days: string[],
  holidays: Map<string, { label: string; color: string }> | undefined,
  { t, locale }: Pick<PageContext, "t" | "locale">,
): number {
  // ── Week number row ──
  // Group consecutive days by ISO week
  const weekSpans: { week: number; startIdx: number; count: number }[] = [];
  let currentWeek = -1;
  for (let i = 0; i < days.length; i++) {
    const wk = getISOWeek(days[i]);
    if (wk !== currentWeek) {
      weekSpans.push({ week: wk, startIdx: i, count: 1 });
      currentWeek = wk;
    } else {
      weekSpans[weekSpans.length - 1].count++;
    }
  }

  // Empty corner cell for week row
  drawCell(doc, margin, y, nameColWidth, weekHeaderHeight, "", {
    bg: [209, 213, 219], fontSize: 6, bold: true, align: "center",
  });
  for (const span of weekSpans) {
    const x = margin + nameColWidth + span.startIdx * dayColWidth;
    const spanWidth = span.count * dayColWidth;
    drawCell(doc, x, y, spanWidth, weekHeaderHeight, t("exportFiles.common.weekLabel", { week: span.week }), {
      bg: [209, 213, 219], fontSize: 6, bold: true, align: "center",
    });
  }
  y += weekHeaderHeight;

  // ── Day header row ──
  drawCell(doc, margin, y, nameColWidth, dayHeaderHeight, "", {
    bg: [229, 231, 235], fontSize: 6, bold: true, align: "center",
  });
  days.forEach((day, i) => {
    const holiday = holidays?.get(day);
    const d = new Date(day);
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const bg: [number, number, number] = holiday ? hexToRgb(holiday.color) : isWeekend ? [220, 220, 230] : [229, 231, 235];
    const fg: [number, number, number] | undefined = holiday ? contrastColor(holiday.color) : undefined;
    drawCell(doc, margin + nameColWidth + i * dayColWidth, y, dayColWidth, dayHeaderHeight,
      formatDate(day, locale, "EEE dd/MM"), { bg, fg, fontSize: 5, bold: true, align: "center" });
  });
  return y + dayHeaderHeight;
}

// ── List (table) ──────────────────────────────────────────────

function drawListContent(ctx: PageContext, data: ExportData) {
  const { doc, w, h, t, locale, dates: settings } = ctx;
  const margin = 20;
  const tableWidth = w - margin * 2;
  const headers = [
    t("exportFiles.columns.title"), t("exportFiles.columns.project"), t("exportFiles.columns.dates"),
    t("exportFiles.columns.assignees"), t("exportFiles.columns.status"), t("exportFiles.columns.place"),
    t("exportFiles.columns.resource"),
  ];
  const colRatios = [0.22, 0.15, 0.15, 0.18, 0.1, 0.1, 0.1];
  const colWidths = colRatios.map(r => r * tableWidth);
  const headerHeight = 18;
  const rowHeight = 16;
  const maxY = h - FOOTER_ZONE - 5;

  let y = CONTENT_TOP;

  // ── Header row ──
  let x = margin;
  headers.forEach((hdr, i) => {
    drawCell(doc, x, y, colWidths[i], headerHeight, hdr, {
      bg: [124, 58, 237], fg: [255, 255, 255], fontSize: 8, bold: true, align: "center",
    });
    x += colWidths[i];
  });
  y += headerHeight;

  // ── Data rows ──
  data.tasks.forEach((task, idx) => {
    if (y + rowHeight > maxY) {
      y = newPage(ctx);
    }

    const altBg: [number, number, number] | null = idx % 2 === 1 ? [249, 250, 251] : null;
    const dates = task.endDate && task.endDate !== task.startDate
      ? `${formatDate(task.startDate, locale, settings.dateFormat)} → ${formatDate(task.endDate, locale, settings.dateFormat)}`
      : formatDate(task.startDate, locale, settings.dateFormat);
    const timeInfo = task.startTime ? ` ${formatTime(task.startTime, locale, settings.timeFormat)}-${formatTime(task.endTime, locale, settings.timeFormat)}` : "";

    const cells = [
      task.title ?? "",
      task.project?.name ?? "",
      dates + timeInfo,
      task.users.map(u => u.name).join(", "),
      task.status?.name ?? "",
      task.place?.name ?? "",
      task.resource?.name ?? "",
    ];

    x = margin;
    cells.forEach((text, i) => {
      drawCell(doc, x, y, colWidths[i], rowHeight, text, {
        bg: altBg, fontSize: 7,
      });
      x += colWidths[i];
    });
    y += rowHeight;
  });
}

// ── Cell drawing helper ──────────────────────────────────────

interface CellOptions {
  bg?: [number, number, number] | null;
  fg?: [number, number, number];
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  text: string,
  opts: CellOptions = {},
) {
  const { bg, fg = [0, 0, 0], fontSize = 7, bold = false, align = "left" } = opts;

  if (bg) {
    doc.save();
    doc.rect(x, y, w, h).fill(bg);
    doc.restore();
  }

  doc.save();
  doc.lineWidth(0.5).strokeColor([200, 200, 200]);
  doc.rect(x, y, w, h).stroke();
  doc.restore();

  if (text) {
    doc.save();
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(fg);
    const padding = 2;
    doc.text(text, x + padding, y + 2, {
      width: w - padding * 2,
      height: h - 4,
      align,
      ellipsis: true,
      lineBreak: false,
    });
    doc.restore();
  }
}

// ── Calendar views ──────────────────────────────────────────────

/** Day column header: « Lun 01/03 » / "Mon 01/03". */
function dayColumnLabel(day: string, locale: AppLocale): string {
  return `${shortDayName(day, locale)} ${formatDate(day, locale, "dd/MM")}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

interface CalendarTask {
  task: ExportTask;
  startMin: number;
  endMin: number;
  slot: number;
}

function allocateCalendarSlots(tasks: ExportTask[]): { allocated: CalendarTask[]; maxSlot: number } {
  const timed = tasks
    .filter(t => t.startTime)
    .map(t => ({
      task: t,
      startMin: timeToMinutes(t.startTime!),
      endMin: t.endTime ? timeToMinutes(t.endTime) : timeToMinutes(t.startTime!) + 60,
      slot: 0,
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const slotEnds: number[] = [];
  for (const item of timed) {
    let assigned = -1;
    for (let i = 0; i < slotEnds.length; i++) {
      if (slotEnds[i] <= item.startMin) { assigned = i; break; }
    }
    if (assigned === -1) { assigned = slotEnds.length; slotEnds.push(0); }
    slotEnds[assigned] = item.endMin;
    item.slot = assigned;
  }

  return { allocated: timed, maxSlot: Math.max(0, slotEnds.length - 1) };
}

function getTasksForDay(data: ExportData, day: string): ExportTask[] {
  return data.tasks.filter(task => {
    const start = task.startDate;
    const end = task.endDate ?? task.startDate;
    return day >= start && day <= end;
  });
}

/** Personal calendar — hours view */
function drawCalendarContent(
  ctx: PageContext, data: ExportData,
  calendarView: "hours" | "days",
  workStart: number, workEnd: number,
) {
  if (calendarView === "days") {
    drawCalendarDaysView(ctx, data);
  } else {
    drawCalendarHoursView(ctx, data, workStart, workEnd);
  }
}

function drawCalendarHoursView(
  ctx: PageContext, data: ExportData,
  workStart: number, workEnd: number,
) {
  const { doc, w, h, t, locale } = ctx;
  const margin = 20;
  const days = data.dateRange.days;
  const hourLabelWidth = 40;
  const dayHeaderHeight = 24;
  const hourHeight = 30;
  const hours = Array.from({ length: workEnd - workStart }, (_, i) => workStart + i);
  const maxY = h - FOOTER_ZONE - 5;

  // Max days per page based on paper width
  const maxDaysPerPage = Math.max(1, Math.floor((w - margin * 2 - hourLabelWidth) / 80));

  for (let chunkStart = 0; chunkStart < days.length; chunkStart += maxDaysPerPage) {
    if (chunkStart > 0) {
      ctx.doc.addPage();
      ctx.pageNum++;
      drawPageHeader(ctx);
    }

    const chunk = days.slice(chunkStart, chunkStart + maxDaysPerPage);
    const dayColWidth = (w - margin * 2 - hourLabelWidth) / chunk.length;

    let y = CONTENT_TOP;

    // Day headers
    drawCell(doc, margin, y, hourLabelWidth, dayHeaderHeight, "", {
      bg: [229, 231, 235], fontSize: 7,
    });
    chunk.forEach((day, i) => {
      const d = new Date(day);
      const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      const label = dayColumnLabel(day, locale);
      drawCell(doc, margin + hourLabelWidth + i * dayColWidth, y, dayColWidth, dayHeaderHeight, label, {
        bg: isWeekend ? [220, 220, 230] : [229, 231, 235],
        fontSize: 8, bold: true, align: "center",
      });
    });
    y += dayHeaderHeight;

    // All-day tasks row
    const allDayTasksByDay = chunk.map(day =>
      getTasksForDay(data, day).filter(t => !t.startTime)
    );
    const maxAllDay = Math.max(1, ...allDayTasksByDay.map(ts => ts.length));
    const allDayRowHeight = maxAllDay * 14 + 4;

    drawCell(doc, margin, y, hourLabelWidth, allDayRowHeight, t("exportFiles.pdf.calendar.allDay"), {
      bg: [245, 245, 245], fontSize: 6, bold: true, align: "center",
    });
    chunk.forEach((day, i) => {
      const x = margin + hourLabelWidth + i * dayColWidth;
      // Background
      doc.save();
      doc.rect(x, y, dayColWidth, allDayRowHeight).fill([250, 250, 255]);
      doc.lineWidth(0.5).strokeColor([200, 200, 200]);
      doc.rect(x, y, dayColWidth, allDayRowHeight).stroke();
      doc.restore();
      // Tasks
      allDayTasksByDay[i].forEach((task, ti) => {
        const taskY = y + 2 + ti * 14;
        const color = task.project?.color || "#6366f1";
        const bg = lightenRgb(color)!;
        const fg = contrastRgb(bg);
        const label = task.project?.name || task.title || "";
        doc.save();
        doc.rect(x + 2, taskY, dayColWidth - 4, 12).fill(bg);
        doc.font("Helvetica").fontSize(5.5).fillColor(fg);
        doc.text(label, x + 4, taskY + 2, {
          width: dayColWidth - 8, height: 10, lineBreak: false, ellipsis: true,
        });
        doc.restore();
      });
    });
    y += allDayRowHeight;

    // Hour grid with positioned tasks
    hours.forEach((hour) => {
      if (y + hourHeight > maxY) {
        y = newPage(ctx);
        // Re-draw day headers
        drawCell(doc, margin, y, hourLabelWidth, dayHeaderHeight, "", {
          bg: [229, 231, 235], fontSize: 7,
        });
        chunk.forEach((day, i) => {
          const label = dayColumnLabel(day, locale);
          drawCell(doc, margin + hourLabelWidth + i * dayColWidth, y, dayColWidth, dayHeaderHeight, label, {
            bg: [229, 231, 235], fontSize: 8, bold: true, align: "center",
          });
        });
        y += dayHeaderHeight;
      }

      // Hour label
      drawCell(doc, margin, y, hourLabelWidth, hourHeight, formatHourLabel(hour, locale, ctx.dates.timeFormat), {
        bg: [245, 245, 245], fontSize: 7, bold: true, align: "center",
      });

      // Day columns — draw grid cells
      chunk.forEach((_day, i) => {
        const x = margin + hourLabelWidth + i * dayColWidth;
        doc.save();
        doc.lineWidth(0.3).strokeColor([220, 220, 220]);
        doc.rect(x, y, dayColWidth, hourHeight).stroke();
        doc.restore();
      });

      // Place tasks in this hour for each day
      chunk.forEach((day, i) => {
        const dayTasks = getTasksForDay(data, day).filter(t => t.startTime);
        const { allocated, maxSlot } = allocateCalendarSlots(dayTasks);
        const colCount = maxSlot + 1;
        const x = margin + hourLabelWidth + i * dayColWidth;
        const slotW = (dayColWidth - 2) / colCount;
        const hourStartMin = hour * 60;
        const hourEndMin = (hour + 1) * 60;

        for (const at of allocated) {
          // Check if task overlaps this hour
          if (at.endMin <= hourStartMin || at.startMin >= hourEndMin) continue;

          const drawStart = Math.max(at.startMin, hourStartMin);
          const drawEnd = Math.min(at.endMin, hourEndMin);
          const topOffset = ((drawStart - hourStartMin) / 60) * hourHeight;
          const blockH = ((drawEnd - drawStart) / 60) * hourHeight;

          const taskX = x + 1 + at.slot * slotW;
          const taskW = slotW - 1;
          const taskY = y + topOffset;

          const color = at.task.project?.color || "#6366f1";
          const bg = lightenRgb(color)!;
          const fg = contrastRgb(bg);

          doc.save();
          doc.rect(taskX, taskY, taskW, blockH).fill(bg);
          // Left border accent
          doc.rect(taskX, taskY, 2, blockH).fill(hexToRgb(color));

          if (blockH > 6) {
            const label = at.task.project?.name || at.task.title || "";
            doc.font("Helvetica").fontSize(5).fillColor(fg);
            doc.text(label, taskX + 4, taskY + 1, {
              width: taskW - 6, height: blockH - 2, lineBreak: false, ellipsis: true,
            });
          }
          doc.restore();
        }
      });

      y += hourHeight;
    });
  }
}

function drawCalendarDaysView(ctx: PageContext, data: ExportData) {
  const { doc, w, h, locale } = ctx;
  const margin = 20;
  const days = data.dateRange.days;
  const maxY = h - FOOTER_ZONE - 5;

  const maxCols = Math.min(days.length, 7);
  const colWidth = (w - margin * 2) / maxCols;
  const dayHeaderHeight = 22;
  const taskCardHeight = 16;
  const taskGap = 2;

  for (let chunkStart = 0; chunkStart < days.length; chunkStart += maxCols) {
    if (chunkStart > 0) {
      ctx.doc.addPage();
      ctx.pageNum++;
      drawPageHeader(ctx);
    }

    const chunk = days.slice(chunkStart, chunkStart + maxCols);
    let y = CONTENT_TOP;

    // Day headers
    chunk.forEach((day, i) => {
      const d = new Date(day);
      const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      const label = longDayLabel(day, locale);
      drawCell(doc, margin + i * colWidth, y, colWidth, dayHeaderHeight, label, {
        bg: isWeekend ? [220, 220, 230] : [59, 130, 246],
        fg: isWeekend ? [0, 0, 0] : [255, 255, 255],
        fontSize: 8, bold: true, align: "center",
      });
    });
    y += dayHeaderHeight;

    // Find max tasks for all days in chunk to align column heights
    const tasksByDay = chunk.map(day => getTasksForDay(data, day));
    const maxTasks = Math.max(1, ...tasksByDay.map(ts => ts.length));
    const columnHeight = Math.min(maxY - y, maxTasks * (taskCardHeight + taskGap) + 8);

    // Draw column backgrounds and tasks
    chunk.forEach((day, i) => {
      const x = margin + i * colWidth;
      const d = new Date(day);
      const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;

      // Column background
      doc.save();
      doc.rect(x, y, colWidth, columnHeight).fill(isWeekend ? [248, 248, 252] : [255, 255, 255]);
      doc.lineWidth(0.3).strokeColor([220, 220, 220]);
      doc.rect(x, y, colWidth, columnHeight).stroke();
      doc.restore();

      // Tasks
      tasksByDay[i].forEach((task, ti) => {
        const taskY = y + 4 + ti * (taskCardHeight + taskGap);
        if (taskY + taskCardHeight > y + columnHeight) return;

        const color = task.project?.color || "#6366f1";
        const bg = lightenRgb(color)!;
        const fg = contrastRgb(bg);

        doc.save();
        doc.rect(x + 3, taskY, colWidth - 6, taskCardHeight).fill(bg);
        doc.rect(x + 3, taskY, 2, taskCardHeight).fill(hexToRgb(color));

        const timeStr = task.startTime ? `${formatTime(task.startTime, locale, ctx.dates.timeFormat)}` : "";
        const label = `${timeStr ? timeStr + " " : ""}${task.project?.name || task.title || ""}`;
        doc.font("Helvetica").fontSize(5.5).fillColor(fg);
        doc.text(label, x + 7, taskY + 3, {
          width: colWidth - 14, height: taskCardHeight - 4, lineBreak: false, ellipsis: true,
        });
        doc.restore();
      });
    });
  }
}

/** Team-day: all users as rows, hours as columns, for a single day */
function drawCalendarTeamDayContent(
  ctx: PageContext, data: ExportData,
  workStart: number, workEnd: number,
) {
  const { doc, w, h } = ctx;
  const margin = 20;
  const days = data.dateRange.days;
  const day = days[0]; // team-day = single day

  if (!day) return;

  const nameColWidth = Math.min(120, (w - margin * 2) * 0.15);
  const hours = Array.from({ length: workEnd - workStart }, (_, i) => workStart + i);
  const hourColWidth = (w - margin * 2 - nameColWidth) / hours.length;
  const headerHeight = 22;
  const rowHeight = 30;
  const maxY = h - FOOTER_ZONE - 5;

  let y = CONTENT_TOP;

  // Header row: empty + hours
  drawCell(doc, margin, y, nameColWidth, headerHeight, "", {
    bg: [229, 231, 235], fontSize: 7,
  });
  hours.forEach((hour, i) => {
    drawCell(doc, margin + nameColWidth + i * hourColWidth, y, hourColWidth, headerHeight, formatHourLabel(hour, ctx.locale, ctx.dates.timeFormat), {
      bg: [229, 231, 235], fontSize: 8, bold: true, align: "center",
    });
  });
  y += headerHeight;

  // User rows
  for (const row of data.rows) {
    if (row.type === "header") continue;

    if (y + rowHeight > maxY) {
      y = newPage(ctx);
      // Redraw header
      drawCell(doc, margin, y, nameColWidth, headerHeight, "", {
        bg: [229, 231, 235], fontSize: 7,
      });
      hours.forEach((hour, i) => {
        drawCell(doc, margin + nameColWidth + i * hourColWidth, y, hourColWidth, headerHeight, formatHourLabel(hour, ctx.locale, ctx.dates.timeFormat), {
          bg: [229, 231, 235], fontSize: 8, bold: true, align: "center",
        });
      });
      y += headerHeight;
    }

    // Name cell
    const nameBg = row.color ? lightenRgb(row.color) : null;
    const nameFg = nameBg ? contrastRgb(nameBg) : undefined;
    drawCell(doc, margin, y, nameColWidth, rowHeight, row.label, {
      bg: nameBg, fg: nameFg, fontSize: 7, bold: true,
    });

    // Hour cells background
    hours.forEach((_hour, i) => {
      const x = margin + nameColWidth + i * hourColWidth;
      doc.save();
      doc.lineWidth(0.3).strokeColor([220, 220, 220]);
      doc.rect(x, y, hourColWidth, rowHeight).stroke();
      doc.restore();
    });

    // Tasks for this user on this day
    const userTasks = getTasksForRowAndDay(data, row.id, day).filter(t => t.startTime);
    const { allocated, maxSlot } = allocateCalendarSlots(userTasks);
    const slotCount = maxSlot + 1;
    const slotH = (rowHeight - 2) / slotCount;

    for (const at of allocated) {
      // Position within the hour columns
      const startOffset = (at.startMin - workStart * 60) / 60;
      const duration = (at.endMin - at.startMin) / 60;

      if (startOffset + duration <= 0 || startOffset >= hours.length) continue;

      const clampedStart = Math.max(0, startOffset);
      const clampedEnd = Math.min(hours.length, startOffset + duration);
      const taskX = margin + nameColWidth + clampedStart * hourColWidth;
      const taskW = (clampedEnd - clampedStart) * hourColWidth;
      const taskY = y + 1 + at.slot * slotH;
      const taskH = slotH - 1;

      const color = at.task.project?.color || "#6366f1";
      const bg = lightenRgb(color)!;
      const fg = contrastRgb(bg);

      doc.save();
      doc.rect(taskX, taskY, taskW, taskH).fill(bg);
      doc.rect(taskX, taskY, 2, taskH).fill(hexToRgb(color));

      if (taskW > 20) {
        const label = at.task.project?.name || at.task.title || "";
        doc.font("Helvetica").fontSize(5).fillColor(fg);
        doc.text(label, taskX + 4, taskY + 1, {
          width: taskW - 6, height: taskH - 2, lineBreak: false, ellipsis: true,
        });
      }
      doc.restore();
    }

    // All-day tasks (no startTime) — show as full-width badges at bottom of row
    const allDayTasks = getTasksForRowAndDay(data, row.id, day).filter(t => !t.startTime);
    if (allDayTasks.length > 0) {
      const totalHoursWidth = hours.length * hourColWidth;
      allDayTasks.slice(0, 2).forEach((task, ti) => {
        const badgeY = y + rowHeight - 10 - ti * 10;
        const color = task.project?.color || "#6366f1";
        const bg = lightenRgb(color)!;
        const fg = contrastRgb(bg);
        doc.save();
        doc.rect(margin + nameColWidth + 1, badgeY, totalHoursWidth - 2, 9).fill(bg);
        doc.font("Helvetica").fontSize(4.5).fillColor(fg);
        doc.text(task.project?.name || task.title || "", margin + nameColWidth + 3, badgeY + 1, {
          width: totalHoursWidth - 6, height: 7, lineBreak: false, ellipsis: true,
        });
        doc.restore();
      });
    }

    y += rowHeight;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats pages (optional, appended at the end of the PDF)
// ─────────────────────────────────────────────────────────────────────────────

function fmtHoursPdf(n: number, locale: AppLocale): string {
  if (!Number.isFinite(n) || n === 0) return "0 h";
  return `${n.toLocaleString(INTL_TAG[locale], { maximumFractionDigits: 2 })} h`;
}

function drawStatsSectionHeader(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number): number {
  doc.save();
  doc.rect(x, y, width, 18).fill([124, 58, 237]); // violet (#7c3aed)
  doc.font("Helvetica-Bold").fontSize(10).fillColor("white");
  doc.text(text, x + 8, y + 5, { width: width - 16, lineBreak: false });
  doc.restore();
  return y + 22;
}

function drawStatsTableHeader(
  doc: PDFKit.PDFDocument,
  headers: string[],
  widths: number[],
  x: number,
  y: number,
  rowH: number,
): number {
  doc.save();
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    doc.rect(cx, y, widths[i], rowH).fillAndStroke([229, 231, 235], [0, 0, 0]);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("black");
    const align: "left" | "right" = i === 0 || i === 1 ? "left" : "right";
    doc.text(headers[i], cx + 3, y + rowH / 2 - 3, {
      width: widths[i] - 6,
      align,
      lineBreak: false,
      ellipsis: true,
    });
    cx += widths[i];
  }
  doc.restore();
  return y + rowH;
}

function drawStatsTableRow(
  doc: PDFKit.PDFDocument,
  values: (string | number)[],
  widths: number[],
  x: number,
  y: number,
  rowH: number,
  alternate: boolean,
  colorCell0?: string | null,
  redCellIdx?: number,
): number {
  doc.save();
  let cx = x;
  for (let i = 0; i < values.length; i++) {
    const fill: [number, number, number] = i === 0 && colorCell0
      ? lightenRgb(colorCell0) ?? [255, 255, 255]
      : i === redCellIdx
        ? [254, 226, 226]
        : alternate
          ? [249, 250, 251]
          : [255, 255, 255];
    doc.rect(cx, y, widths[i], rowH).fillAndStroke(fill, [180, 180, 180]);
    const isRed = i === redCellIdx;
    doc.font(isRed ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor(isRed ? [185, 28, 28] : [20, 20, 20]);
    const align: "left" | "right" = i === 0 || i === 1 ? "left" : "right";
    doc.text(String(values[i] ?? ""), cx + 3, y + rowH / 2 - 2.5, {
      width: widths[i] - 6,
      align,
      lineBreak: false,
      ellipsis: true,
    });
    cx += widths[i];
  }
  doc.restore();
  return y + rowH;
}

function ensureSpace(ctx: PageContext, y: number, needed: number, headers: string[], widths: number[], x: number, rowH: number, headerRedraw: boolean): number {
  const limit = ctx.h - FOOTER_ZONE - 10;
  if (y + needed <= limit) return y;
  y = newPage(ctx);
  if (headerRedraw) {
    y = drawStatsTableHeader(ctx.doc, headers, widths, x, y, rowH);
  }
  return y;
}

function drawStatsTotalRow(
  doc: PDFKit.PDFDocument,
  values: (string | number)[],
  widths: number[],
  x: number,
  y: number,
  rowH: number,
  redCellIdx?: number,
): number {
  doc.save();
  let cx = x;
  for (let i = 0; i < values.length; i++) {
    const isRed = i === redCellIdx;
    const fill: [number, number, number] = isRed ? [254, 226, 226] : [221, 214, 254]; // light violet
    doc.rect(cx, y, widths[i], rowH).fillAndStroke(fill, [100, 100, 100]);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(isRed ? [185, 28, 28] : [20, 20, 20]);
    const align: "left" | "right" = i === 0 || i === 1 ? "left" : "right";
    doc.text(String(values[i] ?? ""), cx + 3, y + rowH / 2 - 2.5, {
      width: widths[i] - 6,
      align,
      lineBreak: false,
      ellipsis: true,
    });
    cx += widths[i];
  }
  doc.restore();
  return y + rowH;
}

function drawStatsPages(ctx: PageContext, stats: ExportStatsData) {
  const { doc, w, h, t: tr, locale } = ctx;
  const hrs = (n: number) => fmtHoursPdf(n, locale);
  const margin = 30;
  const usableWidth = w - margin * 2;
  const rowH = 16;

  // Start on a new page
  let y = newPage(ctx);

  // Title block
  doc.save();
  doc.font("Helvetica-Bold").fontSize(16).fillColor("black");
  doc.text(tr("exportFiles.stats.title", { start: formatDate(stats.period.startDate, locale, ctx.dates.dateFormat), end: formatDate(stats.period.endDate, locale, ctx.dates.dateFormat) }), margin, y, {
    width: usableWidth,
    align: "center",
    lineBreak: false,
  });
  y += 22;
  const t = stats.totals;
  doc.font("Helvetica").fontSize(9).fillColor([107, 114, 128]);
  doc.text(
    `${tr("exportFiles.stats.counts", { projects: t.totalProjects, users: t.totalUsers, tasks: t.totalTasks })} — ` +
      tr("exportFiles.stats.periodHours", { total: hrs(t.totalHours), consumed: hrs(t.consumedHours), upcoming: hrs(t.upcomingHours) }),
    margin,
    y,
    { width: usableWidth, align: "center", lineBreak: false },
  );
  y += 20;
  doc.restore();

  if (stats.projects.length === 0) {
    doc.save();
    doc.font("Helvetica").fontSize(10).fillColor([120, 120, 120]);
    doc.text(tr("exportFiles.stats.noData"), margin, y, { width: usableWidth, align: "center", lineBreak: false });
    doc.restore();
    return;
  }

  // ── Section 1: Hours per project (period) ──
  y = drawStatsSectionHeader(doc, tr("exportFiles.stats.sections.periodHours"), margin, y, usableWidth);
  const headers1 = [
    tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.group"), tr("exportFiles.stats.columns.total"),
    tr("exportFiles.stats.columns.consumedHours"), tr("exportFiles.stats.columns.upcoming"), tr("exportFiles.stats.columns.tasks"),
    tr("exportFiles.stats.columns.usersShort"),
  ];
  const ratios1 = [0.32, 0.16, 0.11, 0.13, 0.11, 0.085, 0.085];
  const widths1 = ratios1.map((r) => Math.floor(r * usableWidth));
  const diff1 = usableWidth - widths1.reduce((s, v) => s + v, 0);
  widths1[0] += diff1;

  y = drawStatsTableHeader(doc, headers1, widths1, margin, y, rowH);
  stats.projects.forEach((p, idx) => {
    y = ensureSpace(ctx, y, rowH, headers1, widths1, margin, rowH, true);
    y = drawStatsTableRow(
      doc,
      [p.projectName, p.groupName || "—", hrs(p.totalHours), hrs(p.consumedHours), hrs(p.upcomingHours), p.taskCount, p.userCount],
      widths1,
      margin,
      y,
      rowH,
      idx % 2 === 1,
      p.projectColor,
    );
  });
  // Section 1 total
  y = ensureSpace(ctx, y, rowH, headers1, widths1, margin, rowH, true);
  y = drawStatsTotalRow(
    doc,
    [tr("exportFiles.stats.totalPeriod"), "", hrs(t.totalHours), hrs(t.consumedHours), hrs(t.upcomingHours), t.totalTasks, t.totalUsers],
    widths1,
    margin,
    y,
    rowH,
  );
  y += 16;

  // ── Section 2: Users × project (period) ──
  if (stats.usersByProject.length > 0) {
    y = ensureSpace(ctx, y, rowH * 3, [], [], margin, rowH, false);
    y = drawStatsSectionHeader(doc, tr("exportFiles.stats.sections.usersByProject"), margin, y, usableWidth);

    const headers2 = [
      tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.user"), tr("exportFiles.stats.columns.laborType"),
      tr("exportFiles.stats.columns.hours"),
    ];
    const ratios2 = [0.32, 0.28, 0.22, 0.18];
    const widths2 = ratios2.map((r) => Math.floor(r * usableWidth));
    const diff2 = usableWidth - widths2.reduce((s, v) => s + v, 0);
    widths2[0] += diff2;

    y = drawStatsTableHeader(doc, headers2, widths2, margin, y, rowH);

    // Group by project for sub-totals
    const byProject = new Map<string, typeof stats.usersByProject>();
    for (const u of stats.usersByProject) {
      const list = byProject.get(u.projectId) ?? [];
      list.push(u);
      byProject.set(u.projectId, list);
    }

    let idx = 0;
    for (const [, userList] of byProject) {
      for (const u of userList) {
        y = ensureSpace(ctx, y, rowH, headers2, widths2, margin, rowH, true);
        y = drawStatsTableRow(
          doc,
          [u.projectName, u.userName, u.laborTypeName || "—", hrs(u.hours)],
          widths2,
          margin,
          y,
          rowH,
          idx % 2 === 1,
          u.projectColor,
        );
        idx++;
      }
      // Sub-total per project
      const subTotal = userList.reduce((s, u) => s + u.hours, 0);
      y = ensureSpace(ctx, y, rowH, headers2, widths2, margin, rowH, true);
      doc.save();
      let cx = margin;
      const subValues = [`  └ ${tr("exportFiles.stats.subtotal", { project: userList[0]?.projectName ?? "" })}`, "", "", hrs(Math.round(subTotal * 100) / 100)];
      for (let i = 0; i < subValues.length; i++) {
        doc.rect(cx, y, widths2[i], rowH).fillAndStroke([243, 244, 246], [180, 180, 180]);
        doc.font("Helvetica-Oblique").fontSize(7.5).fillColor([75, 85, 99]);
        const align: "left" | "right" = i < 3 ? "left" : "right";
        doc.text(String(subValues[i] ?? ""), cx + 3, y + rowH / 2 - 2.5, {
          width: widths2[i] - 6,
          align,
          lineBreak: false,
          ellipsis: true,
        });
        cx += widths2[i];
      }
      doc.restore();
      y += rowH;
    }

    // Grand total section 2
    const grandTotalUsersHours = stats.usersByProject.reduce((s, u) => s + u.hours, 0);
    y = ensureSpace(ctx, y, rowH, headers2, widths2, margin, rowH, true);
    y = drawStatsTotalRow(
      doc,
      [tr("exportFiles.stats.totalPeriod"), "", "", hrs(Math.round(grandTotalUsersHours * 100) / 100)],
      widths2,
      margin,
      y,
      rowH,
    );
    y += 16;
  }

  // ── Section 3: Labor budgets ──
  const projectsWithBudgets = stats.projects.filter((p) => p.budgets.length > 0);
  if (projectsWithBudgets.length > 0) {
    y = ensureSpace(ctx, y, rowH * 3, [], [], margin, rowH, false);
    y = drawStatsSectionHeader(doc, tr("exportFiles.stats.sections.budgets"), margin, y, usableWidth);

    const headers3 = [
      tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.laborType"), tr("exportFiles.stats.columns.budget"),
      tr("exportFiles.stats.columns.consumed"), tr("exportFiles.stats.columns.upcoming"), tr("exportFiles.stats.columns.remaining"),
      "%",
    ];
    const ratios3 = [0.3, 0.2, 0.11, 0.13, 0.11, 0.1, 0.05];
    const widths3 = ratios3.map((r) => Math.floor(r * usableWidth));
    const diff3 = usableWidth - widths3.reduce((s, v) => s + v, 0);
    widths3[0] += diff3;

    y = drawStatsTableHeader(doc, headers3, widths3, margin, y, rowH);
    let idx = 0;
    for (const p of projectsWithBudgets) {
      for (const b of p.budgets) {
        y = ensureSpace(ctx, y, rowH, headers3, widths3, margin, rowH, true);
        const used = b.totalConsumed + b.totalUpcoming;
        const progress = b.plannedHours > 0 ? Math.round((used / b.plannedHours) * 100) : 0;
        const redIdx = b.remaining < 0 ? 5 : undefined;
        y = drawStatsTableRow(
          doc,
          [
            p.projectName,
            `${b.laborTypeName} (${b.laborTypeInitials})`,
            hrs(b.plannedHours),
            hrs(b.totalConsumed),
            hrs(b.totalUpcoming),
            hrs(b.remaining),
            `${progress}%`,
          ],
          widths3,
          margin,
          y,
          rowH,
          idx % 2 === 1,
          p.projectColor,
          redIdx,
        );
        idx++;
      }
    }

    // Budget grand total
    const bt = stats.budgetTotals;
    const budgetUsed = bt.lifetimeConsumed + bt.lifetimeUpcoming;
    const budgetProgress = bt.plannedHours > 0 ? Math.round((budgetUsed / bt.plannedHours) * 100) : 0;
    const budgetRedIdx = bt.remaining < 0 ? 5 : undefined;
    y = ensureSpace(ctx, y, rowH, headers3, widths3, margin, rowH, true);
    y = drawStatsTotalRow(
      doc,
      [
        tr("exportFiles.stats.totalProjects"),
        "",
        hrs(bt.plannedHours),
        hrs(bt.lifetimeConsumed),
        hrs(bt.lifetimeUpcoming),
        hrs(bt.remaining),
        `${budgetProgress}%`,
      ],
      widths3,
      margin,
      y,
      rowH,
      budgetRedIdx,
    );
  }
  // Mark h as used to avoid unused-var errors (h is available for future layout tweaks)
  void h;
}
