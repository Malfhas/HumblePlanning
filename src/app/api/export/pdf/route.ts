import { NextRequest } from "next/server";
import { personInitials } from "@/lib/utils/initials";
import PDFDocument from "pdfkit";
import { requireAuth, requirePermission, handleApiError } from "@/lib/utils/api";
import { formatDate, formatDateTime, formatTime, formatHourLabel, formatWithLocale, parseISO, dateSettingsFromConfig, getTodayInTimezone, type DateSettings } from "@/lib/utils/dates";
import { getConfigValues } from "@/lib/services/config-service";
import { getExportData, getVehicleExportData, getProjectStatsForExport, getTasksForRow, buildExportI18n, shortDayName, longDayLabel, type ExportData, type ExportRow, type ExportTask, type ExportStatsData } from "@/lib/services/export-service";
import { parseExportFilters, type CellContent } from "@/lib/utils/export-params";
import { getProjectGantt, parseProjectGanttScale, parseProjectGanttSort, toWeekScale, weekOf } from "@/lib/services/project-gantt";
import { getConfigValue, getThemeColor } from "@/lib/services/config-service";
import { imageToPng, lightLogoFile } from "@/lib/branding/logo";
import { hexToRgb, readableOnWhite, tint } from "@/lib/utils/theme-color";
import { vibrantizeColor } from "@/lib/canvas/theme";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, translateKey, type ServerTranslator } from "@/i18n/server-translator";
import { INTL_TAG, type AppLocale } from "@/i18n/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// i18n-dynamic: exportFiles.pdf.cover.formats.*
// i18n-dynamic: exportFiles.pdf.cover.views.*
// i18n-dynamic: exportFiles.pdf.cover.cellContents.*
// i18n-dynamic: exportFiles.pdf.cover.sortModes.*
// i18n-dynamic: exportFiles.pdf.cover.ganttSorts.*
// i18n-dynamic: exportFiles.pdf.cover.ganttScales.*

/** kebab-case identifier (`custom-bu-team`) → camelCase key segment (`customBuTeam`). */
const keySegment = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Label of an export option (format, view…); an unknown value (free URL parameter) is shown as is. */
function optionLabel(t: ServerTranslator, group: string, id: string): string {
  return translateKey(t, `exportFiles.pdf.cover.${group}.${keySegment(id)}`) ?? id;
}

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

function pdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// ── Design tokens ──────────────────────────────────────────────

type RGB = [number, number, number];

/** Theme colour of the instance (THEME_COLOR, the HumblePlanning violet by default) and its shades: the accent. */
interface Accent {
  /** Bars and rules. */
  color: RGB;
  /** Text in the accent colour, readable on white whatever the colour chosen. */
  text: RGB;
  /** Tint behind the total rows. */
  tint: RGB;
}

function accentOf(hex: string): Accent {
  return { color: hexToRgb(hex), text: hexToRgb(readableOnWhite(hex)), tint: hexToRgb(tint(hex, 0.08)) };
}
const INK: RGB = [24, 24, 27];
const INK_SOFT: RGB = [63, 63, 70];
const MUTED: RGB = [113, 113, 122];
const LINE: RGB = [212, 212, 216];
const LINE_SOFT: RGB = [228, 228, 231];
const SURFACE: RGB = [250, 250, 250];
const ZEBRA: RGB = [250, 250, 251];
const BAND: RGB = [238, 238, 241];
const WEEKEND: RGB = [244, 244, 246];
const DANGER: RGB = [185, 28, 28];
const DANGER_TINT: RGB = [254, 242, 242];
const WHITE: RGB = [255, 255, 255];

/**
 * Scale of the content pages (every page but the cover). Their layout is in the points of a page CONTENT_SCALE
 * times smaller, drawn CONTENT_SCALE times larger: the text, bars and rows read comfortably once printed, with
 * the proportions of the layout. The sizes below are in these layout points.
 */
const CONTENT_SCALE = 1.3;
/** Left / right page margin. */
const MARGIN = 20;
/** Top of the content, under the page header. */
const CONTENT_TOP = 56;
/** Bottom zone kept for the page footer. */
const FOOTER_ZONE = 30;
/** Capital height of the font (Inter, 0.727; Helvetica, 0.718), in font size units: centres a line of text. */
const CAP = 0.72;
/** Slant of the letters drawn in italic (about 12°): the PDF font has no italic of its own. */
const ITALIC_SLANT = 0.21;

function parseHex(hex: string | null | undefined): RGB | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Perceived luminance, from 0 (black) to 1 (white). */
function luminance([r, g, b]: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Black or white text, whichever reads best on `bg` (rule of the planning bars). */
function textOn(bg: RGB): RGB {
  return luminance(bg) > 0.5 ? INK : WHITE;
}

/**
 * Colour of a project, user, team… as drawn on the planning (`vibrantizeColor`).
 * `null` without colour or for a (nearly) white one: the task is then outlined.
 */
function entityColor(hex: string | null | undefined): RGB | null {
  const rgb = parseHex(hex);
  if (!hex || !rgb || luminance(rgb) > 0.94) return null;
  return parseHex(vibrantizeColor(hex)) ?? rgb;
}

/** A colour readable as text on a light background (a light one is darkened). */
function inkOf(rgb: RGB): RGB {
  const k = luminance(rgb) > 0.6 ? 0.55 : 1;
  return [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)];
}

function isWeekendDay(day: string): boolean {
  const d = new Date(day).getUTCDay();
  return d === 0 || d === 6;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Text helpers ───────────────────────────────────────────────

/** The two weights of the PDF font (see `registerFonts`): text, and titles and labels. */
type FontName = "Regular" | "Bold";

/** Folder of Inter (SIL Open Font License 1.1, see its LICENSE.txt): legible at small sizes, and with every
 *  Latin, Greek and Cyrillic letter, where the standard Helvetica of PDF readers only has Western European ones. */
const FONT_DIR = join(process.cwd(), "src", "assets", "fonts", "inter");
let interFiles: Promise<{ regular: Buffer; bold: Buffer } | null> | null = null;

/** Gives the PDF its two weights: Inter regular and semi-bold, or Helvetica when the files cannot be read. */
async function registerFonts(doc: PDFKit.PDFDocument) {
  interFiles ??= Promise.all([readFile(join(FONT_DIR, "Inter-Regular.ttf")), readFile(join(FONT_DIR, "Inter-SemiBold.ttf"))])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error: unknown) => {
      console.error("[PDF export] Inter font files unreadable, Helvetica used instead:", error instanceof Error ? error.message : error); // i18n-ignore server log (internal)
      return null;
    });
  const files = await interFiles;
  doc.registerFont("Regular", files?.regular ?? "Helvetica");
  doc.registerFont("Bold", files?.bold ?? "Helvetica-Bold");
}

/** Font size last set through `font()`: the text helpers place the baseline from it. */
const fontSizes = new WeakMap<PDFKit.PDFDocument, number>();

function font(doc: PDFKit.PDFDocument, name: FontName, size: number, color: RGB): PDFKit.PDFDocument {
  fontSizes.set(doc, size);
  return doc.font(name).fontSize(size).fillColor(color);
}

/**
 * Text with the top of its capitals at `y`, the convention of this layout whatever the ascender of the font.
 * `italic` slants the letters around their baseline.
 */
function putText(doc: PDFKit.PDFDocument, text: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}, italic = false) {
  const baseline = y + (fontSizes.get(doc) ?? 12) * CAP;
  if (italic) doc.save().transform(1, 0, -ITALIC_SLANT, 1, ITALIC_SLANT * baseline, 0);
  doc.text(text, x, baseline, { lineBreak: false, ...options, baseline: "alphabetic" });
  if (italic) doc.restore();
}

const ELLIPSIS = "\u2026";

/** `text` cut with an ellipsis to fit `maxWidth` in the current font. */
function fitText(doc: PDFKit.PDFDocument, text: string, maxWidth: number, spacing = 0): string {
  if (!text || maxWidth <= 0) return "";
  const width = (s: string) => doc.widthOfString(s, { characterSpacing: spacing });
  if (width(text) <= maxWidth) return text;
  const ellipsisWidth = width(ELLIPSIS);
  if (ellipsisWidth > maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (width(text.slice(0, mid)) + ellipsisWidth <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + ELLIPSIS : "";
}

/**
 * One line of text in the current font, top of the capitals at `y`: never
 * wrapped nor paginated, cut with an ellipsis to `width` when given.
 */
function textLine(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  opts: { width?: number; align?: "left" | "center" | "right"; spacing?: number; italic?: boolean } = {},
) {
  const spacing = opts.spacing ?? 0;
  const fitted = opts.width === undefined ? text : fitText(doc, text, opts.width, spacing);
  if (!fitted) return;
  let left = x;
  if (opts.width !== undefined && opts.align && opts.align !== "left") {
    const free = opts.width - doc.widthOfString(fitted, { characterSpacing: spacing });
    left += opts.align === "center" ? free / 2 : free;
  }
  putText(doc, fitted, left, y, { characterSpacing: spacing }, opts.italic);
}

/** Whole words of `text` on at most `maxLines` lines of `width`, the last one cut with an ellipsis. */
function wrapText(doc: PDFKit.PDFDocument, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = text.trim();
  while (rest && lines.length < maxLines) {
    if (lines.length === maxLines - 1 || doc.widthOfString(rest) <= width) {
      lines.push(fitText(doc, rest, width));
      break;
    }
    const words = rest.split(/\s+/);
    let n = 1;
    while (n < words.length && doc.widthOfString(words.slice(0, n + 1).join(" ")) <= width) n++;
    lines.push(fitText(doc, words.slice(0, n).join(" "), width));
    rest = words.slice(n).join(" ");
  }
  return lines.filter(Boolean);
}

/** `text` on as many lines of `width` as needed, never cut with an ellipsis: a word is only split when alone too long. */
function wrapAll(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (width < 8) return words.length ? [words.join(" ")] : [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (doc.widthOfString(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (rest.length > 1 && doc.widthOfString(rest) > width) {
      let n = rest.length - 1;
      while (n > 1 && doc.widthOfString(rest.slice(0, n)) > width) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Rounded rectangle path; a side whose bar goes on (next block / page) keeps square corners. */
function barPath(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, r: number, roundLeft = true, roundRight = true): PDFKit.PDFDocument {
  const rl = roundLeft ? Math.min(r, w / 2, h / 2) : 0;
  const rr = roundRight ? Math.min(r, w / 2, h / 2) : 0;
  doc.moveTo(x + rl, y).lineTo(x + w - rr, y);
  if (rr) doc.quadraticCurveTo(x + w, y, x + w, y + rr);
  doc.lineTo(x + w, y + h - rr);
  if (rr) doc.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  doc.lineTo(x + rl, y + h);
  if (rl) doc.quadraticCurveTo(x, y + h, x, y + h - rl);
  doc.lineTo(x, y + rl);
  if (rl) doc.quadraticCurveTo(x, y, x + rl, y);
  return doc.closePath();
}

/** Task colour block: filled with the project colour, or outlined without one. Returns the text colour. */
function fillTaskShape(doc: PDFKit.PDFDocument, color: RGB | null, path: () => void): RGB {
  path();
  if (color) {
    doc.fill(color);
    return textOn(color);
  }
  doc.lineWidth(0.6).fillAndStroke(WHITE, MUTED);
  return INK;
}

/** Task label with the style of its status (bold, italic, underline, strikethrough), as on the planning. */
function drawTaskLabel(
  doc: PDFKit.PDFDocument,
  text: string,
  status: ExportTask["status"],
  x: number, top: number, width: number, height: number,
  size: number, color: RGB,
) {
  const bold = !!status?.bold;
  const italic = !!status?.italic;
  font(doc, bold ? "Bold" : "Regular", size, color);
  const fitted = fitText(doc, text, width);
  if (!fitted) return;
  const y = top + (height - size * CAP) / 2;
  putText(doc, fitted, x, y, {}, italic);
  if (status?.underline || status?.strikethrough) {
    const lineY = status.strikethrough ? y + size * CAP * 0.5 : y + size * (CAP + 0.12);
    doc.moveTo(x, lineY).lineTo(x + doc.widthOfString(fitted), lineY)
      .lineWidth(Math.max(0.3, size * 0.07)).strokeColor(color).stroke();
  }
}

// ── Page helper ──

interface PageContext {
  doc: PDFKit.PDFDocument;
  /** Page size, in layout points (see CONTENT_SCALE for the content pages). */
  w: number;
  h: number;
  pageNum: number;
  /** A content page is open at CONTENT_SCALE (its graphics state is restored before the next page). */
  scaled?: boolean;
  /** Top of the content when the page header holds more than usual (legend of the project Gantt). */
  contentTop?: number;
  /** Export language (request language) and associated translator. */
  locale: AppLocale;
  t: ServerTranslator;
  accent: Accent;
  /** Instance date settings (pattern, 24 h / 12 h, time zone). */
  dates: DateSettings;
}

/** Logo as embedded in the PDF: a data URI, so pdfkit stores the image once for every page. */
interface Logo {
  src: string;
  width: number;
  height: number;
}

/** Header and footer of the content pages. */
interface PageChrome {
  appTitle: string;
  subtitle: string;
  /** Export format, in the accent colour (« PLANNING »). */
  formatLabel: string;
  exportedOn: string;
  footerText: string;
  logo: Logo | null;
  accent: Accent;
}

/** Content pages: the header and footer are drawn at the end (they need the page count). */
function newPage(ctx: PageContext): number {
  closeContentPage(ctx);
  ctx.doc.addPage();
  ctx.pageNum++;
  ctx.doc.save().scale(CONTENT_SCALE);
  ctx.scaled = true;
  return ctx.contentTop ?? CONTENT_TOP;
}

/** Ends the scale of the open content page: each page keeps a balanced graphics state. */
function closeContentPage(ctx: PageContext) {
  if (!ctx.scaled) return;
  ctx.doc.restore();
  ctx.scaled = false;
}

function drawPageHeader(doc: PDFKit.PDFDocument, w: number, c: PageChrome) {
  const top = 16;
  const ruleY = 44;
  let textX = MARGIN;
  let accentWidth = 36;
  if (c.logo) {
    const logoH = 24;
    const logoW = Math.min(72, (c.logo.width / c.logo.height) * logoH);
    doc.image(c.logo.src, MARGIN, top - 3, { fit: [logoW, logoH], valign: "center" });
    textX = MARGIN + logoW + 10;
    accentWidth = logoW;
  }
  const rightW = Math.min(180, w * 0.3);
  const leftW = w - MARGIN - rightW - 12 - textX;
  font(doc, "Bold", 12, INK);
  textLine(doc, c.appTitle, textX, top, { width: leftW });
  font(doc, "Regular", 7.5, MUTED);
  textLine(doc, c.subtitle, textX, top + 16, { width: leftW });
  const rightX = w - MARGIN - rightW;
  font(doc, "Bold", 8, c.accent.text);
  textLine(doc, c.formatLabel, rightX, top + 1, { width: rightW, align: "right", spacing: 0.8 });
  font(doc, "Regular", 6.5, MUTED);
  textLine(doc, c.exportedOn, rightX, top + 16.5, { width: rightW, align: "right" });
  doc.moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).lineWidth(0.5).strokeColor(LINE_SOFT).stroke();
  doc.rect(MARGIN, ruleY - 0.75, accentWidth, 1.5).fill(c.accent.color);
}

/** Height of the legend of the project Gantt, under the page header. */
const LEGEND_H = 14;

/** Today (YYYY-MM-DD) in the time zone of the instance. */
function todayIn(dates: DateSettings): string {
  return getTodayInTimezone(dates.timezone);
}

/**
 * Legend of the project Gantt, under the page header: the statuses of its tasks (their colour and name), then the
 * milestone diamond and the line of today when they appear.
 */
function drawGanttLegend(doc: PDFKit.PDFDocument, w: number, tasks: ExportTask[], days: string[], today: string, t: ServerTranslator) {
  const items: { kind: "status" | "milestone" | "today"; label: string; color: RGB }[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = task.status?.id ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: "status", label: task.status?.name ?? t("exportFiles.pdf.projectGantt.noStatus"), color: statusColorOf(task) });
  }
  if (tasks.some(task => task.isMilestone)) items.push({ kind: "milestone", label: t("exportFiles.pdf.projectGantt.milestone"), color: MUTED });
  if (days.includes(today)) items.push({ kind: "today", label: t("exportFiles.pdf.projectGantt.today"), color: TODAY_LINE });
  const y = 49;
  let x = MARGIN;
  font(doc, "Regular", 6, MUTED);
  for (const item of items) {
    const textW = doc.widthOfString(item.label);
    if (x + 14 + textW > w - MARGIN) break;
    if (item.kind === "status") doc.roundedRect(x, y + 1.2, 10, 4.5, 1.5).fill(item.color);
    else if (item.kind === "milestone") doc.moveTo(x + 5, y).lineTo(x + 8.5, y + 3.5).lineTo(x + 5, y + 7).lineTo(x + 1.5, y + 3.5).closePath().lineWidth(0.6).stroke(MILESTONE);
    else doc.moveTo(x + 5, y - 0.5).lineTo(x + 5, y + 7.5).lineWidth(0.9).strokeColor(item.color).stroke();
    font(doc, "Regular", 6, MUTED);
    textLine(doc, item.label, x + 13, y + (7 - 6 * CAP) / 2);
    x += 13 + textW + 10;
  }
}

function drawPageFooter(doc: PDFKit.PDFDocument, w: number, h: number, c: PageChrome, pageLabel: string) {
  const ruleY = h - 22;
  doc.moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).lineWidth(0.5).strokeColor(LINE_SOFT).stroke();
  font(doc, "Regular", 6.5, MUTED);
  textLine(doc, c.footerText, MARGIN, ruleY + 6, { width: w - MARGIN * 2 - 100 });
  textLine(doc, pageLabel, w - MARGIN - 90, ruleY + 6, { width: 90, align: "right" });
}

// ── Load logo as PNG buffer (pdfkit only supports PNG/JPEG) ──

/**
 * The logo fits a 120 pt box on the cover: 4 px per point stays sharp in print (an SVG is drawn straight at that
 * size, not at its declared one: see `imageToPng`).
 */
const LOGO_MAX_PX = 480;

async function loadLogoPng(): Promise<Buffer | null> {
  // The PDF has a light background: the light variant of the logo. pdfkit reads neither AVIF, WebP nor SVG.
  const file = await lightLogoFile();
  if (!file) return null;
  try {
    return await imageToPng(await readFile(file), LOGO_MAX_PX, LOGO_MAX_PX);
  } catch {
    return null;
  }
}

/** PNG size from its IHDR header (bytes 16-23). */
function toLogo(png: Buffer): Logo {
  return { src: `data:image/png;base64,${png.toString("base64")}`, width: png.readUInt32BE(16) || 1, height: png.readUInt32BE(20) || 1 };
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
  /** Project Gantt: the project and the order of its rows, instead of the view and the cells. */
  project?: string;
  ganttSort?: string;
  ganttScale?: string;
}

function drawCoverPage(ctx: PageContext, logoSrc: string | null, info: CoverInfo) {
  const { doc, w, h, t } = ctx;
  doc.addPage();
  ctx.pageNum++;
  // The cover never flows onto a second page (pdfkit adds one under the bottom margin)
  doc.page.margins.bottom = 0;

  const label = (group: string, id: string) => optionLabel(t, group, id);
  const summaryLines = info.project
    ? [
      t("exportFiles.pdf.cover.format", { value: label("formats", info.format) }),
      t("exportFiles.pdf.cover.project", { value: info.project }),
      t("exportFiles.pdf.cover.ganttSort", { value: label("ganttSorts", info.ganttSort ?? "date") }),
      t("exportFiles.pdf.cover.ganttScale", { value: label("ganttScales", info.ganttScale ?? "days") }),
    ]
    : [
      t("exportFiles.pdf.cover.format", { value: label("formats", info.format) }),
      t("exportFiles.pdf.cover.view", { value: label("views", info.viewMode) }),
      t("exportFiles.pdf.cover.cellContent", { value: label("cellContents", info.cellContent) }),
    ];
  if (!info.project && info.sortMode) summaryLines.push(t("exportFiles.pdf.cover.sort", { value: label("sortModes", info.sortMode) }));
  summaryLines.push(t("exportFiles.pdf.cover.exportDate", { date: info.exportDate }));
  const activeFilters = info.filterCounts.filter(f => f.count > 0);

  // Small paper (A5 landscape) or many filters: the cover moves up, then its logo
  // shrinks, so that everything holds on the page; unchanged otherwise
  const textHeight = 150 + summaryLines.length * 16 + (activeFilters.length > 0 ? 26 + activeFilters.length * 14 : 0);
  const bottom = h - FOOTER_ZONE - 5;
  const logoSpace = logoSrc ? 150 : 0;
  let y = Math.max(24, Math.min(h * 0.15, bottom - logoSpace - textHeight));
  const logoSize = Math.max(60, 120 - Math.max(0, y + logoSpace + textHeight - bottom));

  // Logo
  if (logoSrc) {
    try {
      doc.image(logoSrc, (w - logoSize) / 2, y, { fit: [logoSize, logoSize], align: "center", valign: "center" });
      y += logoSize + 30;
    } catch {
      y += 30;
    }
  }

  // App title
  doc.save();
  font(doc, "Bold", 28, [30, 30, 30]);
  putText(doc, info.appTitle, 40, y, { width: w - 80, align: "center", lineBreak: true });
  y += 45;

  // Subtitle
  font(doc, "Regular", 16, [80, 80, 80]);
  putText(doc, info.titleText, 40, y, { width: w - 80, align: "center", lineBreak: true });
  y += 50;

  // Separator line
  doc.moveTo(w * 0.3, y).lineTo(w * 0.7, y).lineWidth(1).strokeColor([180, 180, 180]).stroke();
  y += 30;

  // Summary section
  font(doc, "Bold", 12, [50, 50, 50]);
  putText(doc, t("exportFiles.pdf.cover.summaryTitle"), 40, y, { width: w - 80, align: "center", lineBreak: true });
  y += 25;

  font(doc, "Regular", 10, [80, 80, 80]);

  const summaryX = w * 0.3;
  for (const line of summaryLines) {
    putText(doc, line, summaryX, y, { width: w * 0.4, lineBreak: true });
    y += 16;
  }

  // Active filters
  if (activeFilters.length > 0) {
    y += 10;
    font(doc, "Bold", 10, [50, 50, 50]);
    putText(doc, t("exportFiles.pdf.cover.activeFilters"), summaryX, y);
    y += 16;
    font(doc, "Regular", 10, [80, 80, 80]);
    for (const f of activeFilters) {
      putText(doc, t("exportFiles.pdf.cover.filterCount", { label: f.label, count: f.count }), summaryX + 10, y);
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

    // Project Gantt: one project, a row per task title; otherwise the planning (or the vehicles)
    const ganttSort = parseProjectGanttSort(params.get("ganttSort"));
    const ganttScale = parseProjectGanttScale(params.get("ganttScale"));
    const ganttByDay = format === "project-gantt"
      ? await getProjectGantt(filters, params.get("projectId") ?? "", ganttSort, locale, session.user.name, i18n, perms)
      : null;
    const projectGantt = ganttByDay && ganttScale === "weeks" ? toWeekScale(ganttByDay) : ganttByDay;
    // The line of today, on demand
    const ganttToday = params.get("ganttToday") === "1" ? todayIn(dates) : "";
    const isVehicleMode = !projectGantt && filters.viewMode === "vehicles";
    const data = projectGantt
      ? { ...projectGantt.data, rows: projectGantt.rows.map(row => ({ id: row.id, label: row.label, type: "row" as const })) }
      : isVehicleMode
        ? await getVehicleExportData(filters, session.user.name, i18n, perms)
        : await getExportData(filters, session.user.name, i18n, perms);

    const size = PAGE_SIZES[paperSize] || PAGE_SIZES.A4;
    const [w, h] = orientation === "landscape" ? [size[1], size[0]] : size;

    const doc = new PDFDocument({
      size: [w, h],
      margins: { top: CONTENT_TOP, bottom: FOOTER_ZONE, left: MARGIN, right: MARGIN },
      autoFirstPage: false,
      bufferPages: true,
    });
    await registerFonts(doc);

    // Adapt title based on calendar mode
    const range = { start: fmt(filters.startDate), end: fmt(filters.endDate) };
    let titleText: string;
    if (projectGantt) {
      titleText = t("exportFiles.pdf.titles.projectGantt", { project: projectGantt.projectLabel, ...range });
    } else if (filters.calendarMode === "personal" && filters.calendarUserId) {
      const userRow = data.rows.find(r => r.id === filters.calendarUserId);
      titleText = userRow
        ? t("exportFiles.pdf.titles.personal", { name: userRow.label, ...range })
        : t("exportFiles.pdf.titles.personalUnknown", range);
    } else if (filters.calendarMode === "personal") {
      titleText = t("exportFiles.pdf.titles.everyone", range);
    } else if (isVehicleMode) {
      titleText = t("exportFiles.pdf.titles.vehicles", range);
    } else {
      titleText = t("exportFiles.pdf.titles.default", range);
    }
    const ctx: PageContext = { doc, w, h, pageNum: 0, locale, t, dates, accent: accentOf(await getThemeColor()) };

    // ── Cover page ──
    const [logoPng, appTitle] = await Promise.all([
      loadLogoPng(),
      getConfigValue("APP_TITLE").then(v => v || "HumblePlanning"),
    ]);
    const logo = logoPng ? toLogo(logoPng) : null;

    const coverInfo: CoverInfo = {
      appTitle,
      titleText,
      format,
      viewMode: filters.viewMode,
      sortMode: filters.sortMode,
      cellContent,
      exportDate: formatDateTime(new Date(), locale, dates),
      project: projectGantt?.projectLabel,
      ganttSort,
      ganttScale,
      // The planning filters do not apply to the project Gantt
      filterCounts: projectGantt ? [] : [
        { label: t("exportFiles.pdf.cover.filters.teams"), count: filters.teamIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.users"), count: filters.userIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.projects"), count: filters.projectIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.statuses"), count: filters.statusIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.places"), count: filters.placeIds?.length ?? 0 },
        { label: t("exportFiles.pdf.cover.filters.resources"), count: filters.resourceIds?.length ?? 0 },
      ],
    };
    drawCoverPage(ctx, logo?.src ?? null, coverInfo);

    // ── Content pages, laid out in the points of a smaller page (CONTENT_SCALE) ──
    const pages: PageContext = { ...ctx, w: w / CONTENT_SCALE, h: h / CONTENT_SCALE };
    newPage(pages);

    const fitOnePage = params.get("fitOnePage") === "1";
    // Names of projects and people in full, on several lines if need be (grid and list)
    const fullNames = params.get("fullNames") === "1";
    const calendarView = params.get("calendarView") || "hours";
    const viewLabel = optionLabel(t, "views", filters.viewMode);

    if (format === "calendar") {
      const [amStart, pmEnd] = await Promise.all([
        getConfigValue("AM_START").then(v => v || "08:00"),
        getConfigValue("PM_END").then(v => v || "17:00"),
      ]);
      const workStart = parseInt(amStart.split(":")[0], 10);
      const workEnd = parseInt(pmEnd.split(":")[0], 10);
      // The calendar of everyone (no person chosen) shows who works on each task
      const showPeople = !filters.calendarUserId;
      const view = calendarView === "month" || calendarView === "days" ? calendarView : "hours";
      drawCalendarContent(pages, data, view, workStart, workEnd, showPeople, !!filters.excludeWeekends);
    } else if (format === "list") {
      drawListContent(pages, data, fullNames);
    } else if (projectGantt) {
      // Room for the legend of the statuses under the page header
      pages.contentTop = CONTENT_TOP + LEGEND_H;
      drawGanttContent(pages, data, cellContent, false, fullNames, t("exportFiles.pdf.projectGantt.corner"), {
        tasksByRow: new Map(projectGantt.rows.map(row => [row.id, row.tasks])),
        statusBars: true,
        today: ganttToday,
        weeks: ganttScale === "weeks",
      });
    } else {
      drawGanttContent(pages, data, cellContent, fitOnePage, fullNames, viewLabel);
    }

    // ── Optional: stats pages at the end ──
    if (filters.includeStats && !isVehicleMode && !projectGantt) {
      const stats = await getProjectStatsForExport(filters, i18n, perms);
      drawStatsPages(pages, stats);
    }
    closeContentPage(pages);

    // ── Post-processing: header and "Page X / Y" footer on content pages (skip cover = page 0) ──
    const pageRange = doc.bufferedPageRange();
    const totalContentPages = pageRange.count - 1; // exclude cover
    const chrome: PageChrome = {
      appTitle,
      // The view only shapes the rows of the planning grid (and the vehicle title names it)
      subtitle: format === "list" || format === "calendar" || isVehicleMode || projectGantt
        ? titleText
        : `${titleText}  ·  ${t("exportFiles.pdf.cover.view", { value: viewLabel })}`,
      formatLabel: optionLabel(t, "formats", format).toLocaleUpperCase(INTL_TAG[locale]),
      exportedOn: t("exportFiles.pdf.footer.exportedOn", { date: coverInfo.exportDate }),
      footerText: `${appTitle}  ·  ${titleText}`,
      logo,
      accent: ctx.accent,
    };

    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      if (i === 0) continue; // skip cover page
      doc.save().scale(CONTENT_SCALE);
      drawPageHeader(doc, pages.w, chrome);
      if (projectGantt) drawGanttLegend(doc, pages.w, data.tasks, data.dateRange.days, ganttToday && ganttScale === "weeks" ? weekOf(ganttToday) : ganttToday, t);
      drawPageFooter(doc, pages.w, pages.h, chrome, t("exportFiles.pdf.footer.page", { page: i, total: totalContentPages }));
      doc.restore();
    }

    const buffer = await pdfBuffer(doc);
    const today = getTodayInTimezone(dates.timezone).replace(/-/g, "");

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

/** Header rows of the grid: month, week number, day initial, day number. */
const HEAD = { month: 11, week: 9, letter: 8.5, day: 10.5 };
const HEAD_H = HEAD.month + HEAD.week + HEAD.letter + HEAD.day;
/** Space between two blocks of days stacked on a page. */
const BLOCK_GAP = 14;

/** Row geometry; `s` shrinks the rows when the whole period must fit one page. */
function ganttGeometry(s: number) {
  return {
    // Bars about twice as high as their text, as on the planning
    barH: 14 * s,
    laneGap: 2.5 * s,
    padY: 3.5 * s,
    minRowH: 21 * s,
    bandH: 14 * s,
    labelSize: Math.max(4.5, 6.5 * s),
    barSize: Math.max(4, 6 * s),
    /** Line spacing of a row label / a task label wrapped on several lines (full names). */
    labelLineH: Math.max(4.5, 6.5 * s) * 1.3,
    barLineH: Math.max(4, 6 * s) * 1.25,
  };
}

type GanttGeometry = ReturnType<typeof ganttGeometry> & {
  /** Width of the row label column, and of a day. */
  nameW: number;
  colW: number;
  /** Row labels and task labels wrapped on several lines instead of cut with an ellipsis. */
  fullNames?: boolean;
  /** Project Gantt: bars in the colour of their status, without text, milestones as diamonds. */
  statusBars?: boolean;
  /** Project Gantt: the day of the export, marked with a line (when asked). */
  today?: string;
  /** Project Gantt by week: a column per week (its Monday), labelled with its number and date. */
  weeks?: boolean;
};

/** Project Gantt: its rows and their tasks instead of the rows of the planning, bars by status, today marked. */
interface GanttOptions {
  tasksByRow: Map<string, ExportTask[]>;
  statusBars: boolean;
  /** Empty: no line of today. */
  today: string;
  weeks: boolean;
}

/** Colour of a status bar; grey without status. */
const NO_STATUS: RGB = [156, 163, 175];
const statusColorOf = (task: ExportTask): RGB => parseHex(task.status?.color) ?? NO_STATUS;
const TODAY_LINE: RGB = [220, 38, 38];
/** Outline of the milestone diamonds (filled with their status colour), and their sign in the legend. */
const MILESTONE: RGB = [55, 65, 81];

/** A task over consecutive days of a block (indices in the block), on a lane of its row. */
interface GanttBar {
  task: ExportTask;
  start: number;
  end: number;
  lane: number;
  /** The task goes on before / after the block: square end. */
  openLeft: boolean;
  openRight: boolean;
  /** Full names: the label on several lines, and the height of the bar that holds them. */
  lines?: string[];
  height?: number;
}

interface GanttLine {
  row: ExportRow;
  height: number;
  bars: GanttBar[];
  /** Top of each lane, from the top of the row's content (lanes grow with wrapped labels). */
  laneTops: number[];
  /** Full names: the row label on several lines. */
  labelLines?: string[];
}

/** Contiguous runs of the same key (month, week) over `days`. */
function spans(days: string[], key: (day: string) => string): { start: number; count: number }[] {
  const out: { start: number; count: number }[] = [];
  days.forEach((day, i) => {
    if (i > 0 && key(day) === key(days[i - 1])) out[out.length - 1].count++;
    else out.push({ start: i, count: 1 });
  });
  return out;
}

/**
 * Bars of `tasks` over the `days` of a block: one bar per run of consecutive
 * days (a holiday cuts it: that day shows the holiday instead of the tasks, as
 * in the Excel export), stacked on the first free lane like on the planning.
 */
function layoutBars(tasks: ExportTask[], days: string[], holidays: ExportData["holidays"], maxLanes: number): { bars: GanttBar[]; lanes: number } {
  const first = days[0];
  const last = days[days.length - 1];
  const runs: Omit<GanttBar, "lane">[] = [];
  for (const task of tasks) {
    const start = task.startDate;
    const end = task.endDate ?? task.startDate;
    if (end < first || start > last) continue;
    let from = -1;
    for (let i = 0; i <= days.length; i++) {
      const on = i < days.length && days[i] >= start && days[i] <= end && !holidays.has(days[i]);
      if (on && from < 0) {
        from = i;
      } else if (!on && from >= 0) {
        runs.push({ task, start: from, end: i - 1, openLeft: from === 0 && start < first, openRight: i === days.length && end > last });
        from = -1;
      }
    }
  }
  runs.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const laneEnds: number[] = [];
  const bars: GanttBar[] = [];
  for (const run of runs) {
    let lane = laneEnds.findIndex(end => end < run.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(run.end);
    } else {
      laneEnds[lane] = run.end;
    }
    if (lane < maxLanes) bars.push({ ...run, lane });
  }
  return { bars, lanes: Math.min(laneEnds.length, maxLanes) };
}

/** Text of a task bar, as configured for the cells. */
const barLabel = (task: ExportTask, cellContent: CellContent) => getCellText(task, cellContent) || task.title || "";

/** Room for the label of a bar (its inset, then 2.5 pt of padding on each side). */
function barTextWidth(bar: Omit<GanttBar, "lane">, colW: number): number {
  return (bar.end - bar.start + 1) * colW - (bar.openLeft ? 0 : 1.5) - (bar.openRight ? 0 : 1.5) - 5;
}

/** Height of a row and top of its lanes; each lane is as high as its tallest bar. */
function stackLanes(g: GanttGeometry, bars: GanttBar[], lanes: number, labelLines?: string[]): { height: number; laneTops: number[] } {
  const laneH = Array.from({ length: Math.max(1, lanes) }, () => g.barH);
  for (const bar of bars) laneH[bar.lane] = Math.max(laneH[bar.lane], bar.height ?? g.barH);
  const laneTops: number[] = [];
  let top = 0;
  for (const h of laneH) {
    laneTops.push(top);
    top += h + g.laneGap;
  }
  const labelH = g.barH + Math.max(0, (labelLines?.length ?? 1) - 1) * g.labelLineH;
  return { height: Math.max(g.minRowH, Math.max(top - g.laneGap, labelH) + 2 * g.padY), laneTops };
}

/** Height and bars of every row of a block (a row never outgrows a page: else its names are cut, as without full names). */
function layoutBlock(
  doc: PDFKit.PDFDocument, data: ExportData, days: string[], tasksByRow: Map<string, ExportTask[]>,
  g: GanttGeometry, maxBodyH: number, cellContent: CellContent,
): GanttLine[] {
  const maxLanes = Math.max(1, Math.floor((maxBodyH - 2 * g.padY + g.laneGap) / (g.barH + g.laneGap)));
  return data.rows.map(row => {
    if (row.type === "header") return { row, height: g.bandH, bars: [], laneTops: [] };
    const { bars, lanes } = layoutBars(tasksByRow.get(row.id) ?? [], days, data.holidays, maxLanes);
    if (g.fullNames) {
      font(doc, "Regular", g.labelSize, INK);
      const labelLines = wrapAll(doc, row.label, g.nameW - 13);
      const wrapped = g.statusBars ? bars : bars.map(bar => {
        font(doc, bar.task.status?.bold ? "Bold" : "Regular", g.barSize, INK);
        const lines = wrapAll(doc, barLabel(bar.task, cellContent), barTextWidth(bar, g.colW));
        return lines.length > 1 ? { ...bar, lines, height: g.barH + (lines.length - 1) * g.barLineH } : bar;
      });
      const stacked = stackLanes(g, wrapped, lanes, labelLines);
      if (stacked.height <= maxBodyH) return { row, bars: wrapped, labelLines, ...stacked };
    }
    return { row, bars, ...stackLanes(g, bars, lanes) };
  });
}

function drawGanttContent(
  ctx: PageContext, data: ExportData, cellContent: CellContent, fitOnePage: boolean, fullNames: boolean, cornerLabel: string,
  options?: GanttOptions,
) {
  const { doc, w, h } = ctx;
  const contentTop = ctx.contentTop ?? CONTENT_TOP;
  const days = fitOnePage ? data.dateRange.days.slice(0, 120) : data.dateRange.days;
  if (days.length === 0) return;

  const tableWidth = w - MARGIN * 2;
  let nameW = Math.min(150, Math.max(90, tableWidth * 0.2));
  if (fullNames) {
    // Room for the longest name, up to about a third of the table: a longer one wraps
    font(doc, "Regular", ganttGeometry(1).labelSize, INK);
    const widest = data.rows.reduce((max, r) => (r.type === "row" ? Math.max(max, doc.widthOfString(r.label)) : max), 0);
    nameW = Math.min(Math.max(nameW, widest + 14), tableWidth * 0.35);
  }
  // Days per block by page width (layout points), for task names that read: A5 and A4 portrait → 6,
  // A4 and A3 landscape → 8, A2 → 12, A1 → 16, A0 landscape → 20
  const maxPerBlock = fitOnePage ? days.length
    // Project Gantt: bars without text, narrow days (12 pt) for weeks at a glance; by week, 22 pt for the dates
    : options?.statusBars ? Math.max(7, Math.floor((tableWidth - nameW) / (options.weeks ? 22 : 12)))
    : w >= 2400 ? 20 : w >= 1700 ? 16 : w >= 1200 ? 12 : w >= 600 ? 8 : 6;
  // Blocks of even size (no lone day at the end), all with the same day width
  const perBlock = Math.ceil(days.length / Math.ceil(days.length / maxPerBlock));
  const colW = (tableWidth - nameW) / perBlock;
  const maxY = h - FOOTER_ZONE - 5;
  const maxBodyH = maxY - contentTop - HEAD_H;
  const tasksByRow = options?.tasksByRow ?? new Map(data.rows.filter(r => r.type === "row").map(r => [r.id, getTasksForRow(data, r.id)]));

  const blocks: string[][] = [];
  for (let i = 0; i < days.length; i += perBlock) blocks.push(days.slice(i, i + perBlock));

  const extra = { nameW, colW, fullNames, statusBars: options?.statusBars, today: options?.today, weeks: options?.weeks };
  let g: GanttGeometry = { ...ganttGeometry(1), ...extra };
  if (fitOnePage) {
    // The rows shrink (down to 45 %) so that the whole period holds on one page
    const natural = layoutBlock(doc, data, days, tasksByRow, g, maxBodyH, cellContent).reduce((sum, l) => sum + l.height, 0);
    if (natural > maxBodyH) g = { ...ganttGeometry(Math.max(0.45, (maxBodyH / natural) * 0.995)), ...extra };
  }

  let y = contentTop;
  blocks.forEach((block, idx) => {
    const lines = layoutBlock(doc, data, block, tasksByRow, g, maxBodyH, cellContent);
    if (idx > 0) {
      // A block that does not fit the rest of the page starts on a new one
      const blockH = HEAD_H + lines.reduce((sum, l) => sum + l.height, 0);
      if (y + BLOCK_GAP + blockH > maxY) y = newPage(ctx);
      else y += BLOCK_GAP;
    }
    y = drawGanttBlock(ctx, g, block, lines, y, data.holidays, cellContent, cornerLabel);
  });
}

/** One block of days: header, then the rows, continued on new pages with the header repeated. */
function drawGanttBlock(
  ctx: PageContext, g: GanttGeometry, days: string[], lines: GanttLine[], top: number,
  holidays: ExportData["holidays"], cellContent: CellContent, cornerLabel: string,
): number {
  const maxY = ctx.h - FOOTER_ZONE - 5;
  const width = g.nameW + days.length * g.colW;
  let frameTop = top;
  let y = drawGanttHeader(ctx, g, days, top, holidays, cornerLabel);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A group band never ends a page: it goes with the first row under it
    let needed = line.height;
    if (line.row.type === "header") {
      let j = i + 1;
      while (j < lines.length && lines[j].row.type === "header") needed += lines[j++].height;
      if (j < lines.length) needed += lines[j].height;
    }
    if (y + needed > maxY && y > frameTop + HEAD_H + 0.5) {
      drawFrame(ctx.doc, MARGIN, frameTop, width, y);
      drawTodayLine(ctx, g, days, frameTop, y);
      y = newPage(ctx);
      frameTop = y;
      y = drawGanttHeader(ctx, g, days, y, holidays, cornerLabel);
    }
    if (line.row.type === "header") drawGanttBand(ctx, line, y, width);
    else drawGanttRow(ctx, g, days, line, y, holidays, cellContent);
    y += line.height;
  }
  drawFrame(ctx.doc, MARGIN, frameTop, width, y);
  drawTodayLine(ctx, g, days, frameTop, y);
  return y;
}

/** Project Gantt: a red line down the middle of today's column, when today is in the block. */
function drawTodayLine(ctx: PageContext, g: GanttGeometry, days: string[], top: number, bottom: number) {
  if (!g.today) return;
  const index = days.indexOf(g.weeks ? weekOf(g.today) : g.today);
  if (index < 0) return;
  // By week: at the place of today's weekday inside its week column
  const within = g.weeks ? ((new Date(`${g.today}T00:00:00Z`).getUTCDay() + 6) % 7 + 0.5) / 7 : 0.5;
  const x = MARGIN + g.nameW + (index + within) * g.colW;
  ctx.doc.moveTo(x, top + HEAD.month).lineTo(x, bottom).lineWidth(0.9).strokeColor(TODAY_LINE).stroke();
}

/** Thin outer border of a table. */
function drawFrame(doc: PDFKit.PDFDocument, x: number, top: number, width: number, bottom: number) {
  doc.rect(x, top, width, bottom - top).lineWidth(0.6).strokeColor(LINE).stroke();
}

function drawGanttHeader(
  ctx: PageContext, g: GanttGeometry, days: string[], top: number,
  holidays: ExportData["holidays"], cornerLabel: string,
): number {
  const { doc, t, locale } = ctx;
  const xd = MARGIN + g.nameW;
  const colW = g.colW;
  const right = xd + days.length * colW;
  const yWeek = top + HEAD.month;
  const yLetter = yWeek + HEAD.week;
  const yDay = yLetter + HEAD.letter;
  const bottom = yDay + HEAD.day;

  doc.rect(MARGIN, top, right - MARGIN, HEAD_H).fill(SURFACE);
  days.forEach((day, i) => {
    const x = xd + i * colW;
    if (isWeekendDay(day)) doc.rect(x, yLetter, colW, bottom - yLetter).fill(WEEKEND);
    const holiday = parseHex(holidays.get(day)?.color);
    if (holiday) doc.save().fillOpacity(0.16).rect(x, yLetter, colW, bottom - yLetter).fill(holiday).restore();
  });

  // Separators: header rows, then months / weeks / days (each one as high as its level)
  doc.moveTo(xd, yWeek).lineTo(right, yWeek)
    .moveTo(xd, yLetter).lineTo(right, yLetter)
    .moveTo(xd, yDay).lineTo(right, yDay);
  for (let i = 1; i < days.length; i++) {
    const x = xd + i * colW;
    const from = days[i].slice(0, 7) !== days[i - 1].slice(0, 7) ? top
      : getISOWeek(days[i]) !== getISOWeek(days[i - 1]) ? yWeek
        : yLetter;
    doc.moveTo(x, from).lineTo(x, bottom);
  }
  doc.lineWidth(0.4).strokeColor(LINE_SOFT).stroke();
  doc.moveTo(xd, top).lineTo(xd, bottom).moveTo(MARGIN, bottom).lineTo(right, bottom)
    .lineWidth(0.6).strokeColor(LINE).stroke();

  font(doc, "Bold", 6, INK);
  for (const span of spans(days, d => d.slice(0, 7))) {
    const label = capitalize(formatWithLocale(parseISO(days[span.start]), "LLLL yyyy", locale));
    textLine(doc, label, xd + span.start * colW + 3, top + 2.7, { width: span.count * colW - 5 });
  }
  font(doc, "Regular", 5.5, MUTED);
  for (const span of spans(days, d => String(getISOWeek(d)))) {
    const label = t("exportFiles.common.weekLabel", { week: getISOWeek(days[span.start]) });
    textLine(doc, label, xd + span.start * colW, yWeek + (HEAD.week - 5.5 * CAP) / 2, { width: span.count * colW, align: "center" });
  }
  // The day number shrinks on narrow columns (one page for a long period)
  const numSize = Math.max(3.5, Math.min(6.5, (colW - 1.5) / 1.15));
  days.forEach((day, i) => {
    const x = xd + i * colW;
    if (g.weeks) {
      // A week: the date of its Monday
      font(doc, "Bold", Math.min(6, numSize), INK);
      textLine(doc, formatWithLocale(parseISO(day), "dd/MM", locale), x, yDay + (HEAD.day - Math.min(6, numSize) * CAP) / 2, { width: colW, align: "center" });
      return;
    }
    const holiday = parseHex(holidays.get(day)?.color);
    const ink = holiday ? inkOf(holiday) : null;
    if (colW >= 6) {
      font(doc, "Regular", 5, ink ?? MUTED);
      textLine(doc, formatWithLocale(parseISO(day), "EEEEE", locale).toLocaleUpperCase(INTL_TAG[locale]), x, yLetter + (HEAD.letter - 5 * CAP) / 2, { width: colW, align: "center" });
    }
    font(doc, "Bold", numSize, ink ?? INK);
    textLine(doc, String(Number(day.slice(8))), x, yDay + (HEAD.day - numSize * CAP) / 2, { width: colW, align: "center" });
  });

  // Corner: what the rows are
  font(doc, "Bold", 6, MUTED);
  textLine(doc, cornerLabel, MARGIN + 6, bottom - 8, { width: g.nameW - 12 });
  return bottom;
}

/** Group row (team, project group, BU…): light band, label in capitals after the group colour. */
function drawGanttBand(ctx: PageContext, line: GanttLine, y: number, width: number) {
  const { doc, locale } = ctx;
  const h = line.height;
  doc.rect(MARGIN, y, width, h).fill(BAND);
  doc.moveTo(MARGIN, y + h).lineTo(MARGIN + width, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
  let x = MARGIN + 6;
  const color = entityColor(line.row.color);
  const dot = Math.min(5, h * 0.45);
  if (color) {
    doc.roundedRect(x, y + (h - dot) / 2, dot, dot, dot / 4).fill(color);
    x += dot + 4;
  }
  const size = Math.min(6, h * 0.55);
  font(doc, "Bold", size, INK_SOFT);
  textLine(doc, line.row.label.toLocaleUpperCase(INTL_TAG[locale]), x, y + (h - size * CAP) / 2, { width: MARGIN + width - x - 6, spacing: 0.3 });
}

function drawGanttRow(
  ctx: PageContext, g: GanttGeometry, days: string[], line: GanttLine, y: number,
  holidays: ExportData["holidays"], cellContent: CellContent,
) {
  const { doc } = ctx;
  const xd = MARGIN + g.nameW;
  const colW = g.colW;
  const rowH = line.height;

  // Week-end and holiday cells
  days.forEach((day, i) => {
    const x = xd + i * colW;
    if (isWeekendDay(day)) doc.rect(x, y, colW, rowH).fill(WEEKEND);
    const holiday = parseHex(holidays.get(day)?.color);
    if (holiday) doc.save().fillOpacity(0.07).rect(x, y, colW, rowH).fill(holiday).restore();
  });

  // Day separators and bottom line, then the label column border
  for (let i = 1; i < days.length; i++) doc.moveTo(xd + i * colW, y).lineTo(xd + i * colW, y + rowH);
  doc.moveTo(MARGIN, y + rowH).lineTo(xd + days.length * colW, y + rowH);
  doc.lineWidth(0.4).strokeColor(LINE_SOFT).stroke();
  doc.moveTo(xd, y).lineTo(xd, y + rowH).lineWidth(0.6).strokeColor(LINE).stroke();

  // Label, with the row colour as a thin stripe
  const color = entityColor(line.row.color);
  if (color) doc.roundedRect(MARGIN + 3, y + 2.5, 2.2, rowH - 5, 1.1).fill(color);
  font(doc, "Regular", g.labelSize, INK);
  const labelTop = y + g.padY + (g.barH - g.labelSize * CAP) / 2;
  (line.labelLines ?? [line.row.label]).forEach((text, i) => {
    textLine(doc, text, MARGIN + 9, labelTop + i * g.labelLineH, { width: g.nameW - 13 });
  });

  // Holiday: its label on every row (no task that day)
  days.forEach((day, i) => {
    const holiday = holidays.get(day);
    const tint = parseHex(holiday?.color);
    if (!holiday || !tint) return;
    const x = xd + i * colW + 1.5;
    const top = y + g.padY;
    doc.save().fillOpacity(0.13);
    barPath(doc, x, top, colW - 3, g.barH, Math.min(2.5, g.barH / 3)).fill(tint);
    doc.restore();
    font(doc, "Bold", g.barSize, inkOf(tint));
    textLine(doc, holiday.label, x + 2.5, top + (g.barH - g.barSize * CAP) / 2, { width: colW - 8 });
  });

  for (const bar of line.bars) {
    const inset = 1.5;
    const left = xd + bar.start * colW + (bar.openLeft ? 0 : inset);
    const right = xd + (bar.end + 1) * colW - (bar.openRight ? 0 : inset);
    const top = y + g.padY + line.laneTops[bar.lane];
    if (g.statusBars) {
      const color = statusColorOf(bar.task);
      if (bar.task.isMilestone) {
        // Milestone: a diamond in the middle of its first day
        const cx = xd + bar.start * colW + colW / 2;
        const cy = top + g.barH / 2;
        const r = Math.min(g.barH / 2, colW / 2 - 1);
        // A diamond in the colour of its status (to do, done…), outlined so that a light one still reads
        doc.moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy).closePath()
          .lineWidth(0.6).fillAndStroke(color, MILESTONE);
      } else {
        const barTop = top + g.barH * 0.18;
        barPath(doc, left, barTop, right - left, g.barH * 0.64, Math.min(2, g.barH / 4), !bar.openLeft, !bar.openRight).fill(color);
      }
      continue;
    }
    const ink = fillTaskShape(doc, entityColor(bar.task.project?.color),
      () => barPath(doc, left, top, right - left, bar.height ?? g.barH, Math.min(2.5, g.barH / 3), !bar.openLeft, !bar.openRight));
    // Full names: one line after the other, each placed as a one-line label
    (bar.lines ?? [barLabel(bar.task, cellContent)]).forEach((text, i) => {
      drawTaskLabel(doc, text, bar.task.status, left + 2.5, top + i * g.barLineH, right - left - 5, g.barH, g.barSize, ink);
    });
  }
}

// ── List (table) ──────────────────────────────────────────────

function drawListContent(ctx: PageContext, data: ExportData, fullNames: boolean) {
  const { doc, w, h, t, locale, dates: settings } = ctx;
  const tableWidth = w - MARGIN * 2;
  const headers = [
    t("exportFiles.columns.title"), t("exportFiles.columns.project"), t("exportFiles.columns.dates"),
    t("exportFiles.columns.assignees"), t("exportFiles.columns.status"), t("exportFiles.columns.place"),
    t("exportFiles.columns.resource"),
  ];
  const colRatios = [0.2, 0.15, 0.17, 0.18, 0.1, 0.1, 0.1];
  const colWidths = colRatios.map(r => r * tableWidth);
  const headerHeight = 17;
  const rowHeight = 15;
  const maxY = h - FOOTER_ZONE - 5;
  const pad = 5;

  const drawHeader = (top: number): number => {
    doc.rect(MARGIN, top, tableWidth, headerHeight).fill(SURFACE);
    doc.moveTo(MARGIN, top + headerHeight).lineTo(MARGIN + tableWidth, top + headerHeight).lineWidth(0.8).strokeColor(LINE).stroke();
    font(doc, "Bold", 7, INK_SOFT);
    let x = MARGIN;
    headers.forEach((hdr, i) => {
      textLine(doc, hdr, x + pad, top + (headerHeight - 7 * CAP) / 2, { width: colWidths[i] - pad * 2 });
      x += colWidths[i];
    });
    return top + headerHeight;
  };

  let y = drawHeader(CONTENT_TOP);

  const lineH = 7 * 1.3;

  data.tasks.forEach((task, idx) => {
    const dates = task.endDate && task.endDate !== task.startDate
      ? `${formatDate(task.startDate, locale, settings.dateFormat)} – ${formatDate(task.endDate, locale, settings.dateFormat)}`
      : formatDate(task.startDate, locale, settings.dateFormat);
    const timeInfo = task.startTime ? ` ${formatTime(task.startTime, locale, settings.timeFormat)}-${formatTime(task.endTime, locale, settings.timeFormat)}` : "";

    // Project and status read with their colour
    const cells: { text: string; dot?: RGB | null }[] = [
      { text: task.title ?? "" },
      { text: task.project?.name ?? "", dot: task.project ? entityColor(task.project.color) : undefined },
      { text: dates + timeInfo },
      { text: task.users.map(u => u.name).join(", ") },
      { text: task.status?.name ?? "", dot: task.status ? parseHex(task.status.color) : undefined },
      { text: task.place?.name ?? "" },
      { text: task.resource?.name ?? "" },
    ];
    // Full names: each cell on as many lines as it needs, the row as high as its tallest cell
    font(doc, "Regular", 7, INK);
    let x0 = MARGIN;
    const placed = cells.map((cell, i) => {
      const tx = x0 + pad + (cell.dot ? 8 : 0);
      const width = x0 + colWidths[i] - pad - tx;
      x0 += colWidths[i];
      return { ...cell, tx, width, lines: fullNames ? wrapAll(doc, cell.text, width) : [cell.text] };
    });
    const rowH = rowHeight + (Math.max(1, ...placed.map(c => c.lines.length)) - 1) * lineH;

    if (y + rowH > maxY) {
      y = drawHeader(newPage(ctx));
    }

    if (idx % 2 === 1) doc.rect(MARGIN, y, tableWidth, rowH).fill(ZEBRA);
    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + tableWidth, y + rowH).lineWidth(0.4).strokeColor(LINE_SOFT).stroke();

    const textY = y + (rowHeight - 7 * CAP) / 2;
    for (const cell of placed) {
      if (cell.dot) doc.roundedRect(cell.tx - 8, y + (rowHeight - 5) / 2, 5, 5, 1.2).fill(cell.dot);
      font(doc, "Regular", 7, INK);
      cell.lines.forEach((text, i) => textLine(doc, text, cell.tx, textY + i * lineH, { width: cell.width }));
    }
    y += rowH;
  });
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

/** Project name, or title without project. */
const taskName = (task: ExportTask) => task.project?.name || task.title || "";

/** Text of a task in the calendar views, as in the app: its title then its project, or the project alone. */
function calendarLabel(task: ExportTask): string {
  if (task.title && task.project?.name) return `${task.title} · ${task.project.name}`;
  return task.title || task.project?.name || "";
}

/** Initials of a person, as on their avatar (brackets and signs left out). */
const initialsOf = (name: string) => personInitials(name);

/** Avatar colour of a person without one, as in the app. */
const AVATAR_FALLBACK: RGB = [107, 114, 128];

/**
 * Assignees of a task at the right end of its bar (calendar of everyone): discs with their initials, as on the
 * avatars of the app, at most three (two then "+N" beyond). Returns the width they take.
 */
function drawPeople(doc: PDFKit.PDFDocument, users: ExportTask["users"], right: number, top: number, height: number): number {
  if (users.length === 0) return 0;
  const d = Math.min(height - 3, 10);
  const gap = 1.2;
  const shown = users.length > 3 ? users.slice(0, 2) : users;
  const discs: { text: string; color: RGB }[] = shown.map(u => ({ text: initialsOf(u.name), color: parseHex(u.color) ?? AVATAR_FALLBACK }));
  if (users.length > shown.length) discs.push({ text: `+${users.length - shown.length}`, color: [229, 231, 235] });
  const size = d * 0.42;
  let x = right - d;
  for (const disc of discs.reverse()) {
    doc.circle(x + d / 2, top + height / 2, d / 2).fill(disc.color);
    font(doc, "Bold", size, textOn(disc.color));
    textLine(doc, disc.text, x, top + (height - size * CAP) / 2, { width: d, align: "center" });
    x -= d + gap;
  }
  return discs.length * (d + gap);
}

/** Width of the assignee discs of `drawPeople` on a bar of `height`. */
function peopleWidth(users: ExportTask["users"], height: number): number {
  return Math.min(users.length, 3) * (Math.min(height - 3, 10) + 1.2);
}

/** Calendar export: month grid, cards per day or hours, as the Calendar of the app shows them. */
function drawCalendarContent(
  ctx: PageContext, data: ExportData,
  calendarView: "hours" | "days" | "month",
  workStart: number, workEnd: number,
  showPeople: boolean, excludeWeekends: boolean,
) {
  if (calendarView === "month") {
    drawCalendarMonthView(ctx, data, showPeople, excludeWeekends);
  } else if (calendarView === "days") {
    drawCalendarDaysView(ctx, data, showPeople);
  } else {
    drawCalendarHoursView(ctx, data, workStart, workEnd, showPeople);
  }
}

const isoOf = (date: Date) => date.toISOString().slice(0, 10);
const addDaysIso = (day: string, n: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return isoOf(date);
};
/** 0 for Monday … 6 for Sunday. */
const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** A task over consecutive columns of a week row of the month grid, on a lane. */
interface MonthBar { task: ExportTask; start: number; end: number; lane: number; openLeft: boolean; openRight: boolean }

/**
 * Month grid: one row per week (Monday first, without the weekend when it is left out), each task as one bar
 * over its days of the week, stacked on lanes; the rows share the height of the page, and grow with their tasks.
 */
function drawCalendarMonthView(ctx: PageContext, data: ExportData, showPeople: boolean, excludeWeekends: boolean) {
  const { doc, w, h, locale } = ctx;
  const first = isoOf(data.dateRange.start);
  const last = isoOf(data.dateRange.end);
  if (last < first) return;
  const columns = excludeWeekends ? 5 : 7;
  const colW = (w - MARGIN * 2) / columns;
  const maxY = h - FOOTER_ZONE - 5;
  const headH = 16;
  const dayHead = 14;
  const barH = 13;
  const barGap = 2.5;
  const minRowH = 34;

  // Weeks of the period, each with the days of its columns
  const weeks: string[][] = [];
  for (let monday = addDaysIso(first, -weekdayOf(first)); monday <= last; monday = addDaysIso(monday, 7)) {
    weeks.push(Array.from({ length: columns }, (_, i) => addDaysIso(monday, i)));
  }
  const inPeriod = (day: string) => day >= first && day <= last;

  // Bars of each week, on the first free lane (longest first, as on the planning)
  const layout = weeks.map((days) => {
    const shown = days.map((day, i) => (inPeriod(day) ? i : -1)).filter(i => i >= 0);
    if (shown.length === 0) return { days, bars: [] as MonthBar[], lanes: 0 };
    const from = days[shown[0]];
    const to = days[shown[shown.length - 1]];
    const runs: Omit<MonthBar, "lane">[] = [];
    for (const task of data.tasks) {
      const end = task.endDate ?? task.startDate;
      if (end < from || task.startDate > to) continue;
      const start = shown.find(i => days[i] >= task.startDate);
      const stop = [...shown].reverse().find(i => days[i] <= end);
      if (start === undefined || stop === undefined || start > stop) continue;
      runs.push({ task, start, end: stop, openLeft: task.startDate < days[start], openRight: end > days[stop] });
    }
    runs.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start)
      || (a.task.startTime ?? "").localeCompare(b.task.startTime ?? ""));
    const laneEnds: number[] = [];
    const bars = runs.map((run) => {
      let lane = laneEnds.findIndex(end => end < run.start);
      if (lane < 0) lane = laneEnds.push(run.end) - 1;
      else laneEnds[lane] = run.end;
      return { ...run, lane };
    });
    return { days, bars, lanes: laneEnds.length };
  });

  // Rows fill the page when they hold on it (an empty week as high as the others); otherwise they keep their
  // natural height, a week never cut
  const natural = layout.map(week => Math.max(minRowH, dayHead + week.lanes * (barH + barGap) + 4));
  const titleH = 22;
  const room = maxY - CONTENT_TOP - titleH - headH;
  const total = natural.reduce((sum, rowH) => sum + rowH, 0);
  const heights = total <= room ? natural.map(rowH => rowH + (room - total) / natural.length) : natural;

  // Month and year above the grid
  const months = [...new Set([first, last].map(day => capitalize(formatWithLocale(parseISO(day), "LLLL yyyy", locale))))];
  const header = (top: number): number => {
    font(doc, "Bold", 11, INK);
    textLine(doc, months.join(" – "), MARGIN, top + 3, { width: w - MARGIN * 2 });
    const y = top + titleH;
    doc.rect(MARGIN, y, colW * columns, headH).fill(SURFACE);
    font(doc, "Bold", 6.5, MUTED);
    weeks[0].forEach((day, i) => {
      const label = formatWithLocale(parseISO(day), "EEE", locale).toLocaleUpperCase(INTL_TAG[locale]);
      textLine(doc, label, MARGIN + i * colW, y + (headH - 6.5 * CAP) / 2, { width: colW, align: "center" });
    });
    doc.moveTo(MARGIN, y + headH).lineTo(MARGIN + colW * columns, y + headH).lineWidth(0.6).strokeColor(LINE).stroke();
    return y + headH;
  };

  let frameTop = CONTENT_TOP + titleH;
  let y = header(CONTENT_TOP);
  layout.forEach((week, wi) => {
    const rowH = heights[wi];
    if (y + rowH > maxY && y > frameTop + headH + 0.5) {
      drawFrame(doc, MARGIN, frameTop, colW * columns, y);
      frameTop = newPage(ctx) + titleH;
      y = header(frameTop - titleH);
    }
    // Cells: other month greyed, weekend and holiday tinted, day number (with the month on the 1st)
    week.days.forEach((day, i) => {
      const x = MARGIN + i * colW;
      if (!inPeriod(day)) doc.rect(x, y, colW, rowH).fill(SURFACE);
      else if (isWeekendDay(day)) doc.rect(x, y, colW, rowH).fill(WEEKEND);
      const holiday = inPeriod(day) ? data.holidays.get(day) : undefined;
      const tint = parseHex(holiday?.color);
      if (tint) doc.save().fillOpacity(0.07).rect(x, y, colW, rowH).fill(tint).restore();
      const dayNum = Number(day.slice(8));
      const label = dayNum === 1 ? formatWithLocale(parseISO(day), "d MMM", locale) : String(dayNum);
      font(doc, "Bold", 7, inPeriod(day) ? INK : MUTED);
      textLine(doc, label, x + 4, y + 4, { width: colW - 8 });
      if (holiday && tint) {
        const numW = doc.widthOfString(label) + 5;
        font(doc, "Bold", 6, inkOf(tint));
        textLine(doc, holiday.label, x + 4 + numW, y + 4.5, { width: colW - 8 - numW });
      }
    });
    for (let i = 1; i < columns; i++) doc.moveTo(MARGIN + i * colW, y).lineTo(MARGIN + i * colW, y + rowH);
    doc.moveTo(MARGIN, y + rowH).lineTo(MARGIN + colW * columns, y + rowH).lineWidth(0.4).strokeColor(LINE_SOFT).stroke();

    for (const bar of week.bars) {
      const left = MARGIN + bar.start * colW + (bar.openLeft ? 0 : 2);
      const right = MARGIN + (bar.end + 1) * colW - (bar.openRight ? 0 : 2);
      const top = y + dayHead + bar.lane * (barH + barGap);
      const ink = fillTaskShape(doc, entityColor(bar.task.project?.color),
        () => barPath(doc, left, top, right - left, barH, 2.5, !bar.openLeft, !bar.openRight));
      const peopleW = showPeople ? drawPeople(doc, bar.task.users, right - 2, top, barH) : 0;
      const single = bar.task.startDate === (bar.task.endDate ?? bar.task.startDate);
      const time = single && bar.task.startTime ? `${formatTime(bar.task.startTime, locale, ctx.dates.timeFormat)} ` : "";
      drawTaskLabel(doc, time + calendarLabel(bar.task), bar.task.status, left + 3, top, right - left - 6 - peopleW, barH, 6.5, ink);
    }
    y += rowH;
  });
  drawFrame(doc, MARGIN, frameTop, colW * columns, y);
}

/** Header of the day columns (calendar views), after an optional corner column. */
function drawDayColumnsHeader(ctx: PageContext, days: string[], cornerW: number, colW: number, top: number, height: number, label: (day: string) => string): number {
  const { doc } = ctx;
  const xd = MARGIN + cornerW;
  const right = xd + days.length * colW;
  doc.rect(MARGIN, top, right - MARGIN, height).fill(SURFACE);
  days.forEach((day, i) => {
    if (isWeekendDay(day)) doc.rect(xd + i * colW, top, colW, height).fill(WEEKEND);
  });
  for (let i = 1; i < days.length; i++) doc.moveTo(xd + i * colW, top).lineTo(xd + i * colW, top + height);
  doc.lineWidth(0.4).strokeColor(LINE_SOFT).stroke();
  doc.moveTo(MARGIN, top + height).lineTo(right, top + height).lineWidth(0.6).strokeColor(LINE).stroke();
  if (cornerW > 0) doc.moveTo(xd, top).lineTo(xd, top + height).lineWidth(0.6).strokeColor(LINE).stroke();
  font(doc, "Bold", 7.5, INK);
  days.forEach((day, i) => {
    textLine(doc, label(day), xd + i * colW + 3, top + (height - 7.5 * CAP) / 2, { width: colW - 6, align: "center" });
  });
  return top + height;
}

/** Rounded task block of the hours view: name (wrapped when there is room), then the time span. */
function drawCalendarBlock(ctx: PageContext, task: ExportTask, x: number, y: number, w: number, h: number) {
  const { doc, locale, dates } = ctx;
  if (w <= 1 || h <= 1) return;
  const ink = fillTaskShape(doc, entityColor(task.project?.color), () => barPath(doc, x, y, w, h, Math.min(2, h / 3)));
  const size = Math.min(6, Math.max(3.5, h - 2.5));
  const lineH = size * 1.2;
  const room = Math.floor((h - 3) / lineH);
  if (room <= 1) {
    drawTaskLabel(doc, taskName(task), task.status, x + 3, y, w - 5, h, size, ink);
    return;
  }
  const time = [formatTime(task.startTime, locale, dates.timeFormat), formatTime(task.endTime, locale, dates.timeFormat)].filter(Boolean).join(" – ");
  font(doc, "Bold", size, ink);
  const lines = wrapText(doc, taskName(task), w - 6, time ? room - 1 : room);
  let ty = y + 2.5;
  for (const text of lines) {
    putText(doc, text, x + 3, ty);
    ty += lineH;
  }
  if (time) {
    font(doc, "Regular", size - 0.5, ink);
    textLine(doc, time, x + 3, ty, { width: w - 6 });
  }
}

function drawCalendarHoursView(
  ctx: PageContext, data: ExportData,
  workStart: number, workEnd: number,
  showPeople: boolean,
) {
  const { doc, w, h, t, locale } = ctx;
  const days = data.dateRange.days;
  const hourLabelWidth = 36;
  const dayHeaderHeight = 20;
  let hourHeight = 30;
  const hours = Array.from({ length: Math.max(0, workEnd - workStart) }, (_, i) => workStart + i);
  const maxY = h - FOOTER_ZONE - 5;
  const gridWidth = w - MARGIN * 2 - hourLabelWidth;

  // Max days per page based on paper width, spread evenly; same day width on every page
  const maxPerPage = Math.max(1, Math.floor(gridWidth / 80));
  const perPage = Math.ceil(days.length / Math.ceil(days.length / maxPerPage)) || 1;
  const colW = gridWidth / perPage;
  const g: GanttGeometry = { ...ganttGeometry(1), nameW: hourLabelWidth, colW };
  const allDayTasks = data.tasks.filter(task => !task.startTime);

  for (let chunkStart = 0; chunkStart < days.length; chunkStart += perPage) {
    if (chunkStart > 0) newPage(ctx);

    const chunk = days.slice(chunkStart, chunkStart + perPage);
    const xd = MARGIN + hourLabelWidth;
    const width = hourLabelWidth + chunk.length * colW;
    const timedByDay = chunk.map(day => allocateCalendarSlots(getTasksForDay(data, day).filter(task => task.startTime)));
    const header = (top: number) => drawDayColumnsHeader(ctx, chunk, hourLabelWidth, colW, top, dayHeaderHeight, day => dayColumnLabel(day, locale));

    let frameTop = CONTENT_TOP;
    let y = header(frameTop);

    // All-day row: one continuous bar per task, stacked
    const { bars, lanes } = layoutBars(allDayTasks, chunk, new Map(), 12);
    const allDayHeight = Math.max(g.minRowH, Math.max(1, lanes) * (g.barH + g.laneGap) - g.laneGap + 2 * g.padY);
    doc.rect(MARGIN, y, hourLabelWidth, allDayHeight).fill(SURFACE);
    chunk.forEach((day, i) => {
      if (isWeekendDay(day)) doc.rect(xd + i * colW, y, colW, allDayHeight).fill(WEEKEND);
    });
    for (let i = 1; i < chunk.length; i++) doc.moveTo(xd + i * colW, y).lineTo(xd + i * colW, y + allDayHeight);
    doc.lineWidth(0.4).strokeColor(LINE_SOFT).stroke();
    doc.moveTo(MARGIN, y + allDayHeight).lineTo(MARGIN + width, y + allDayHeight).moveTo(xd, y).lineTo(xd, y + allDayHeight)
      .lineWidth(0.6).strokeColor(LINE).stroke();
    font(doc, "Bold", 6, MUTED);
    textLine(doc, t("exportFiles.pdf.calendar.allDay"), MARGIN + 3, y + g.padY + (g.barH - 6 * CAP) / 2, { width: hourLabelWidth - 6, align: "center" });
    for (const bar of bars) {
      const left = xd + bar.start * colW + (bar.openLeft ? 0 : 1.5);
      const right = xd + (bar.end + 1) * colW - (bar.openRight ? 0 : 1.5);
      const top = y + g.padY + bar.lane * (g.barH + g.laneGap);
      const ink = fillTaskShape(doc, entityColor(bar.task.project?.color),
        () => barPath(doc, left, top, right - left, g.barH, 2, !bar.openLeft, !bar.openRight));
      const peopleW = showPeople ? drawPeople(doc, bar.task.users, right - 2, top, g.barH) : 0;
      drawTaskLabel(doc, calendarLabel(bar.task), bar.task.status, left + 2.5, top, right - left - 5 - peopleW, g.barH, g.barSize, ink);
    }
    y += allDayHeight;
    // The working hours share the rest of the page (18 to 30 pt each): the whole day on one page when it can
    hourHeight = Math.max(18, Math.min(30, (maxY - y - 0.5) / Math.max(1, hours.length)));

    // Hour grid; the timed tasks of each page part are drawn as one block each
    let partStartHour = hours[0] ?? workStart;
    let partTop = y;
    const drawTimedTasks = (endHour: number) => {
      const fromMin = partStartHour * 60;
      const toMin = endHour * 60;
      chunk.forEach((_day, i) => {
        const { allocated, maxSlot } = timedByDay[i];
        const slotW = (colW - 3) / (maxSlot + 1);
        for (const at of allocated) {
          const start = Math.max(at.startMin, fromMin);
          const end = Math.min(at.endMin, toMin);
          if (end <= start) continue;
          const top = partTop + ((start - fromMin) / 60) * hourHeight + 0.75;
          const blockH = ((end - start) / 60) * hourHeight - 1.5;
          drawCalendarBlock(ctx, at.task, xd + i * colW + 1.5 + at.slot * slotW, top, slotW - 1, blockH);
        }
      });
    };

    for (const hour of hours) {
      if (y + hourHeight > maxY) {
        drawTimedTasks(hour);
        drawFrame(doc, MARGIN, frameTop, width, y);
        frameTop = newPage(ctx);
        y = header(frameTop);
        partStartHour = hour;
        partTop = y;
      }
      doc.rect(MARGIN, y, hourLabelWidth, hourHeight).fill(SURFACE);
      chunk.forEach((day, i) => {
        if (isWeekendDay(day)) doc.rect(xd + i * colW, y, colW, hourHeight).fill(WEEKEND);
      });
      for (let i = 1; i < chunk.length; i++) doc.moveTo(xd + i * colW, y).lineTo(xd + i * colW, y + hourHeight);
      doc.moveTo(MARGIN, y + hourHeight).lineTo(MARGIN + width, y + hourHeight);
      doc.lineWidth(0.4).strokeColor(LINE_SOFT).stroke();
      doc.moveTo(xd, y).lineTo(xd, y + hourHeight).lineWidth(0.6).strokeColor(LINE).stroke();
      font(doc, "Bold", 6.5, MUTED);
      textLine(doc, formatHourLabel(hour, locale, ctx.dates.timeFormat), MARGIN + 3, y + 3, { width: hourLabelWidth - 8, align: "right" });
      y += hourHeight;
    }
    drawTimedTasks(workEnd);
    drawFrame(doc, MARGIN, frameTop, width, y);
  }
}

function drawCalendarDaysView(ctx: PageContext, data: ExportData, showPeople: boolean) {
  const { doc, w, h, locale } = ctx;
  const days = data.dateRange.days;
  const maxY = h - FOOTER_ZONE - 5;

  const maxCols = Math.min(days.length, 7);
  const colWidth = (w - MARGIN * 2) / maxCols;
  const dayHeaderHeight = 20;
  const taskCardHeight = 16;
  const taskGap = 3;

  for (let chunkStart = 0; chunkStart < days.length; chunkStart += maxCols) {
    if (chunkStart > 0) newPage(ctx);

    const chunk = days.slice(chunkStart, chunkStart + maxCols);
    const width = chunk.length * colWidth;
    // The long labels of the days (« Jeudi 5 novembre ») when they all fit their column, else the short ones
    // (« Jeu 05/11 »): one format for the whole row
    font(doc, "Bold", 7.5, INK);
    const longFits = chunk.every(day => doc.widthOfString(longDayLabel(day, locale)) <= colWidth - 6);
    let y = drawDayColumnsHeader(ctx, chunk, 0, colWidth, CONTENT_TOP, dayHeaderHeight,
      day => (longFits ? longDayLabel(day, locale) : dayColumnLabel(day, locale)));

    // The columns take the height of the page, like a sheet of the calendar
    const tasksByDay = chunk.map(day => getTasksForDay(data, day));
    const columnHeight = maxY - y;

    chunk.forEach((day, i) => {
      if (isWeekendDay(day)) doc.rect(MARGIN + i * colWidth, y, colWidth, columnHeight).fill(WEEKEND);
    });
    for (let i = 1; i < chunk.length; i++) doc.moveTo(MARGIN + i * colWidth, y).lineTo(MARGIN + i * colWidth, y + columnHeight);
    doc.lineWidth(0.4).strokeColor(LINE_SOFT).stroke();

    // Cards one under the other, their text on up to two lines (the card grows), the people at the top right
    const lineH = 8.5;
    chunk.forEach((_day, i) => {
      const x = MARGIN + i * colWidth;
      let taskY = y + 4;
      for (const task of tasksByDay[i]) {
        const timeStr = task.startTime ? `${formatTime(task.startTime, locale, ctx.dates.timeFormat)}` : "";
        const textW = colWidth - 14 - (showPeople ? peopleWidth(task.users, taskCardHeight) : 0);
        font(doc, task.status?.bold ? "Bold" : "Regular", 7, INK);
        const lines = wrapText(doc, `${timeStr ? timeStr + " " : ""}${calendarLabel(task)}`, textW, 2);
        const cardH = taskCardHeight + Math.max(0, lines.length - 1) * lineH;
        if (taskY + cardH > y + columnHeight) break;
        const ink = fillTaskShape(doc, entityColor(task.project?.color),
          () => barPath(doc, x + 3, taskY, colWidth - 6, cardH, 2.5));
        if (showPeople) drawPeople(doc, task.users, x + colWidth - 5, taskY, taskCardHeight);
        lines.forEach((text, li) => {
          drawTaskLabel(doc, text, task.status, x + 7, taskY + li * lineH, textW, taskCardHeight, 7, ink);
        });
        taskY += cardH + taskGap;
      }
    });
    y += columnHeight;
    drawFrame(doc, MARGIN, CONTENT_TOP, width, y);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats pages (optional, appended at the end of the PDF)
// ─────────────────────────────────────────────────────────────────────────────

function fmtHoursPdf(n: number, locale: AppLocale): string {
  if (!Number.isFinite(n) || n === 0) return "0 h";
  return `${n.toLocaleString(INTL_TAG[locale], { maximumFractionDigits: 2 })} h`;
}

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** Section title: bold, after a short accent bar. */
function drawStatsSectionHeader(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, accent: Accent): number {
  doc.roundedRect(x, y, 3, 12, 1).fill(accent.color);
  font(doc, "Bold", 9.5, INK);
  textLine(doc, text, x + 9, y + (12 - 9.5 * CAP) / 2, { width: width - 9 });
  return y + 19;
}

/** Column alignment: the first `leftCols` columns are text, the others numbers. */
const statsAlign = (i: number, leftCols: number): "left" | "right" => (i < leftCols ? "left" : "right");

function drawStatsTableHeader(
  doc: PDFKit.PDFDocument,
  headers: string[],
  widths: number[],
  x: number,
  y: number,
  rowH: number,
  leftCols: number,
): number {
  const width = sum(widths);
  doc.rect(x, y, width, rowH).fill(SURFACE);
  doc.moveTo(x, y + rowH).lineTo(x + width, y + rowH).lineWidth(0.8).strokeColor(LINE).stroke();
  font(doc, "Bold", 7, INK_SOFT);
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    textLine(doc, headers[i], cx + 5, y + (rowH - 7 * CAP) / 2, { width: widths[i] - 10, align: statsAlign(i, leftCols) });
    cx += widths[i];
  }
  return y + rowH;
}

interface StatsRowStyle {
  leftCols: number;
  alternate?: boolean;
  /** Colour of the first column (project); `undefined` = table without colours. */
  color0?: string | null;
  /** Column shown in red (budget overrun). */
  redCellIdx?: number;
  variant?: "row" | "subtotal" | "total";
}

function drawStatsTableRow(
  doc: PDFKit.PDFDocument,
  values: (string | number)[],
  widths: number[],
  x: number,
  y: number,
  rowH: number,
  style: StatsRowStyle,
  accent: Accent,
): number {
  const width = sum(widths);
  const variant = style.variant ?? "row";
  if (variant === "total") doc.rect(x, y, width, rowH).fill(accent.tint);
  else if (variant === "subtotal") doc.rect(x, y, width, rowH).fill(SURFACE);
  else if (style.alternate) doc.rect(x, y, width, rowH).fill(ZEBRA);
  if (style.redCellIdx !== undefined) {
    doc.rect(x + sum(widths.slice(0, style.redCellIdx)), y, widths[style.redCellIdx], rowH).fill(DANGER_TINT);
  }
  if (variant === "total") doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.8).strokeColor(accent.color).stroke();
  doc.moveTo(x, y + rowH).lineTo(x + width, y + rowH).lineWidth(0.4).strokeColor(LINE_SOFT).stroke();

  const size = 7.5;
  let cx = x;
  for (let i = 0; i < values.length; i++) {
    let tx = cx + 5;
    if (i === 0 && variant === "row" && style.color0 !== undefined) {
      const color = entityColor(style.color0);
      if (color) doc.roundedRect(tx, y + (rowH - 8) / 2, 2.2, 8, 1.1).fill(color);
      tx += 7;
    }
    // Sub-total: indented under its project
    if (i === 0 && variant === "subtotal") tx += 7;
    const red = i === style.redCellIdx;
    font(doc, red || variant === "total" ? "Bold" : "Regular", size, red ? DANGER : variant === "subtotal" ? MUTED : INK);
    textLine(doc, String(values[i] ?? ""), tx, y + (rowH - size * CAP) / 2, { width: cx + widths[i] - 5 - tx, align: statsAlign(i, style.leftCols), italic: variant === "subtotal" });
    cx += widths[i];
  }
  return y + rowH;
}

function ensureSpace(ctx: PageContext, y: number, needed: number, headers: string[], widths: number[], x: number, rowH: number, headerRedraw: boolean, leftCols = 2): number {
  const limit = ctx.h - FOOTER_ZONE - 10;
  if (y + needed <= limit) return y;
  y = newPage(ctx);
  if (headerRedraw) {
    y = drawStatsTableHeader(ctx.doc, headers, widths, x, y, rowH, leftCols);
  }
  return y;
}

/** Column widths from ratios, rounded down, the remainder going to the first column. */
function statsWidths(ratios: number[], usableWidth: number): number[] {
  const widths = ratios.map((r) => Math.floor(r * usableWidth));
  widths[0] += usableWidth - sum(widths);
  return widths;
}

function drawStatsPages(ctx: PageContext, stats: ExportStatsData) {
  const { doc, w, t: tr, locale } = ctx;
  const hrs = (n: number) => fmtHoursPdf(n, locale);
  const margin = MARGIN;
  const usableWidth = w - margin * 2;
  const rowH = 15;

  // Start on a new page
  let y = newPage(ctx);

  // Title block
  font(doc, "Bold", 14, INK);
  textLine(doc, tr("exportFiles.stats.title", { start: formatDate(stats.period.startDate, locale, ctx.dates.dateFormat), end: formatDate(stats.period.endDate, locale, ctx.dates.dateFormat) }), margin, y, { width: usableWidth });
  y += 19;
  const t = stats.totals;
  font(doc, "Regular", 8, MUTED);
  textLine(
    doc,
    `${tr("exportFiles.stats.counts", { projects: t.totalProjects, users: t.totalUsers, tasks: t.totalTasks })}  ·  ` +
      tr("exportFiles.stats.periodHours", { total: hrs(t.totalHours), consumed: hrs(t.consumedHours), upcoming: hrs(t.upcomingHours) }),
    margin,
    y,
    { width: usableWidth },
  );
  y += 20;

  if (stats.projects.length === 0) {
    font(doc, "Regular", 10, MUTED);
    textLine(doc, tr("exportFiles.stats.noData"), margin, y, { width: usableWidth });
    return;
  }

  // ── Section 1: Hours per project (period) ──
  y = drawStatsSectionHeader(doc, tr("exportFiles.stats.sections.periodHours"), margin, y, usableWidth, ctx.accent);
  const headers1 = [
    tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.group"), tr("exportFiles.stats.columns.total"),
    tr("exportFiles.stats.columns.consumedHours"), tr("exportFiles.stats.columns.upcoming"), tr("exportFiles.stats.columns.tasks"),
    tr("exportFiles.stats.columns.usersShort"),
  ];
  const widths1 = statsWidths([0.32, 0.16, 0.11, 0.13, 0.11, 0.085, 0.085], usableWidth);

  y = drawStatsTableHeader(doc, headers1, widths1, margin, y, rowH, 2);
  stats.projects.forEach((p, idx) => {
    y = ensureSpace(ctx, y, rowH, headers1, widths1, margin, rowH, true);
    y = drawStatsTableRow(
      doc,
      [p.projectName, p.groupName || "—", hrs(p.totalHours), hrs(p.consumedHours), hrs(p.upcomingHours), p.taskCount, p.userCount],
      widths1,
      margin,
      y,
      rowH,
      { leftCols: 2, alternate: idx % 2 === 1, color0: p.projectColor },
      ctx.accent,
    );
  });
  // Section 1 total
  y = ensureSpace(ctx, y, rowH, headers1, widths1, margin, rowH, true);
  y = drawStatsTableRow(
    doc,
    [tr("exportFiles.stats.totalPeriod"), "", hrs(t.totalHours), hrs(t.consumedHours), hrs(t.upcomingHours), t.totalTasks, t.totalUsers],
    widths1,
    margin,
    y,
    rowH,
    { leftCols: 2, variant: "total" },
    ctx.accent,
  );
  y += 18;

  // ── Section 2: Users × project (period) ──
  if (stats.usersByProject.length > 0) {
    y = ensureSpace(ctx, y, rowH * 3, [], [], margin, rowH, false);
    y = drawStatsSectionHeader(doc, tr("exportFiles.stats.sections.usersByProject"), margin, y, usableWidth, ctx.accent);

    const headers2 = [
      tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.user"), tr("exportFiles.stats.columns.laborType"),
      tr("exportFiles.stats.columns.hours"),
    ];
    const widths2 = statsWidths([0.32, 0.28, 0.22, 0.18], usableWidth);

    y = drawStatsTableHeader(doc, headers2, widths2, margin, y, rowH, 3);

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
        y = ensureSpace(ctx, y, rowH, headers2, widths2, margin, rowH, true, 3);
        y = drawStatsTableRow(
          doc,
          [u.projectName, u.userName, u.laborTypeName || "—", hrs(u.hours)],
          widths2,
          margin,
          y,
          rowH,
          { leftCols: 3, alternate: idx % 2 === 1, color0: u.projectColor },
          ctx.accent,
        );
        idx++;
      }
      // Sub-total per project
      const subTotal = userList.reduce((s, u) => s + u.hours, 0);
      y = ensureSpace(ctx, y, rowH, headers2, widths2, margin, rowH, true, 3);
      y = drawStatsTableRow(
        doc,
        [tr("exportFiles.stats.subtotal", { project: userList[0]?.projectName ?? "" }), "", "", hrs(Math.round(subTotal * 100) / 100)],
        widths2,
        margin,
        y,
        rowH,
        { leftCols: 3, variant: "subtotal" },
        ctx.accent,
      );
    }

    // Grand total section 2
    const grandTotalUsersHours = stats.usersByProject.reduce((s, u) => s + u.hours, 0);
    y = ensureSpace(ctx, y, rowH, headers2, widths2, margin, rowH, true, 3);
    y = drawStatsTableRow(
      doc,
      [tr("exportFiles.stats.totalPeriod"), "", "", hrs(Math.round(grandTotalUsersHours * 100) / 100)],
      widths2,
      margin,
      y,
      rowH,
      { leftCols: 3, variant: "total" },
      ctx.accent,
    );
    y += 18;
  }

  // ── Section 3: Labor budgets ──
  const projectsWithBudgets = stats.projects.filter((p) => p.budgets.length > 0);
  if (projectsWithBudgets.length > 0) {
    y = ensureSpace(ctx, y, rowH * 3, [], [], margin, rowH, false);
    y = drawStatsSectionHeader(doc, tr("exportFiles.stats.sections.budgets"), margin, y, usableWidth, ctx.accent);

    const headers3 = [
      tr("exportFiles.stats.columns.project"), tr("exportFiles.stats.columns.laborType"), tr("exportFiles.stats.columns.budget"),
      tr("exportFiles.stats.columns.consumed"), tr("exportFiles.stats.columns.upcoming"), tr("exportFiles.stats.columns.remaining"),
      "%",
    ];
    const widths3 = statsWidths([0.3, 0.2, 0.11, 0.13, 0.11, 0.1, 0.05], usableWidth);

    y = drawStatsTableHeader(doc, headers3, widths3, margin, y, rowH, 2);
    let idx = 0;
    for (const p of projectsWithBudgets) {
      for (const b of p.budgets) {
        y = ensureSpace(ctx, y, rowH, headers3, widths3, margin, rowH, true);
        const used = b.totalConsumed + b.totalUpcoming;
        const progress = b.plannedHours > 0 ? Math.round((used / b.plannedHours) * 100) : 0;
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
          { leftCols: 2, alternate: idx % 2 === 1, color0: p.projectColor, redCellIdx: b.remaining < 0 ? 5 : undefined },
          ctx.accent,
        );
        idx++;
      }
    }

    // Budget grand total
    const bt = stats.budgetTotals;
    const budgetUsed = bt.lifetimeConsumed + bt.lifetimeUpcoming;
    const budgetProgress = bt.plannedHours > 0 ? Math.round((budgetUsed / bt.plannedHours) * 100) : 0;
    y = ensureSpace(ctx, y, rowH, headers3, widths3, margin, rowH, true);
    drawStatsTableRow(
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
      { leftCols: 2, variant: "total", redCellIdx: bt.remaining < 0 ? 5 : undefined },
      ctx.accent,
    );
  }
}
