"use client";

import { createContext, useContext, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import type { AppLocale } from "@/i18n/config";
import { Loader2, MoreVertical, Maximize2, Minimize2, Download, X } from "lucide-react";
import { formatChartDate } from "./chart-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Context to let children know they're in fullscreen mode
const ChartFullscreenContext = createContext(false);
export function useChartFullscreen() { return useContext(ChartFullscreenContext); }

interface ChartCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  /** Data array for export — each item is a row object */
  exportData?: Record<string, any>[];
  /** Column headers for export */
  exportColumns?: { key: string; header: string }[];
}

/** Format value for export — applies date formatting to date-like strings */
function formatExportValue(v: any, locale: AppLocale): string {
  if (v == null) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(v)) return formatChartDate(v, locale);
  return String(v);
}

function downloadCSV(data: Record<string, any>[], columns: { key: string; header: string }[], filename: string, locale: AppLocale) {
  const headers = columns.map((c) => c.header).join(";");
  const rows = data.map((row) =>
    columns.map((c) => {
      const v = row[c.key];
      return `"${formatExportValue(v, locale)}"`;
    }).join(";")
  );
  const csv = [headers, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadXLSX(data: Record<string, any>[], columns: { key: string; header: string }[], filename: string, locale: AppLocale, sheetName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 20 }));
  for (const row of data) {
    const formatted: Record<string, any> = {};
    for (const c of columns) formatted[c.key] = formatExportValue(row[c.key], locale);
    sheet.addRow(formatted);
  }
  // Style header
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ChartCard({ title, description, children, className, loading, exportData, exportColumns }: ChartCardProps) {
  const t = useTranslations("stats.chart");
  const tc = useTranslations("common");
  const { locale } = useDateFormat();
  const [fullscreen, setFullscreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const safeFilename = title.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ ]/g, "").replace(/\s+/g, "_");
  const canExport = exportData && exportColumns && exportData.length > 0;
  const exportCsv = () => downloadCSV(exportData!, exportColumns!, safeFilename, locale);
  const exportXlsx = () => downloadXLSX(exportData!, exportColumns!, safeFilename, locale, t("sheetName"));

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[100] bg-background flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {canExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1.5" />
                    {tc("actions.export")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={exportCsv}>
                    CSV (.csv)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportXlsx}>
                    Excel (.xlsx)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" size="sm" onClick={() => setFullscreen(false)}>
              <Minimize2 className="h-4 w-4 mr-1.5" />
              {t("exitFullscreen")}
            </Button>
          </div>
        </div>
        <div className="flex-1 p-6 min-h-0 flex items-center justify-center">
          <div className="w-full h-full">
            <ChartFullscreenContext.Provider value={true}>
              {children}
            </ChartFullscreenContext.Provider>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={cardRef} className={cn("rounded-xl border bg-card p-5 shadow-sm", className)}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setFullscreen(true)}>
              <Maximize2 className="h-4 w-4 mr-2" />
              {t("fullscreen")}
            </DropdownMenuItem>
            {canExport && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportCsv}>
                  <Download className="h-4 w-4 mr-2" />
                  {t("exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportXlsx}>
                  <Download className="h-4 w-4 mr-2" />
                  {t("exportExcel")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
