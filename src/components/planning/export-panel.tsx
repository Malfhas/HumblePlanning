"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlanningStore, type ViewMode, type SortMode, type CalendarMode } from "@/stores/planning-store";
import { useFilterStore } from "@/stores/filter-store";
import { useBuStore } from "@/stores/bu-store";
import {
  FileText,
  FileSpreadsheet,
  FileDown,
  Download,
  Loader2,
} from "lucide-react";
import { useDateFormat } from "@/hooks/use-date-format";
import { throwIfNotOk, ApiClientError } from "@/lib/api-client";
import { useTeams } from "@/hooks/use-teams";
import { useUsers, useUser } from "@/hooks/use-users";
import { usePermissions } from "@/hooks/use-permissions";
import { useProjects } from "@/hooks/use-projects";
import { useStatuses } from "@/hooks/use-statuses";
import { usePlaces } from "@/hooks/use-places";
import { useResources } from "@/hooks/use-resources";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { NamedEntity } from "@/types";

// i18n-dynamic: exports.panel.views.*
// i18n-dynamic: exports.panel.sortModes.*
// i18n-dynamic: exports.panel.filters.categories.*
// i18n-dynamic: exports.panel.pdf.orientations.*

type ExportFormat = "pdf" | "excel" | "csv";

const FORMAT_OPTIONS: { value: ExportFormat; icon: typeof FileText; label: string }[] = [
  { value: "pdf", icon: FileText, label: "PDF" },
  { value: "excel", icon: FileSpreadsheet, label: "Excel" },
  { value: "csv", icon: FileDown, label: "CSV" },
];

/** Sort mode \u2192 key segment `exports.panel.sortModes.*`. */
const SORT_LABEL_KEYS = {
  "name-asc": "nameAsc",
  "name-desc": "nameDesc",
  "custom": "custom",
  "team-alpha-custom": "teamAlphaCustom",
  "team-name-asc": "teamNameAsc",
  "team-name-desc": "teamNameDesc",
  "custom-bu": "customBu",
  "custom-bu-team": "customBuTeam",
  "custom-bu-user": "customBuUser",
  "custom-group": "customGroup",
  "group-alpha-custom": "groupAlphaCustom",
  "group-name-asc": "groupNameAsc",
  "group-name-desc": "groupNameDesc",
  "custom-bu-group": "customBuGroup",
  "custom-bu-group-alpha": "customBuGroupAlpha",
  "type-name-asc": "typeNameAsc",
  "type-name-desc": "typeNameDesc",
} as const satisfies Record<SortMode, string>;

const SORT_OPTIONS_BY_VIEW: Record<ViewMode, SortMode[]> = {
  users: ["custom", "team-alpha-custom", "team-name-asc", "team-name-desc", "custom-bu-user", "custom-bu-team", "custom-bu", "name-asc", "name-desc"],
  projects: ["custom-group", "group-alpha-custom", "group-name-asc", "group-name-desc", "custom-bu-group", "custom-bu-group-alpha", "name-asc", "name-desc"],
  places: ["name-asc", "name-desc"],
  resources: ["name-asc", "name-desc"],
  vehicles: ["name-asc", "name-desc", "type-name-asc", "type-name-desc"],
};

const VIEW_MODES = ["users", "projects", "places", "resources", "vehicles"] as const satisfies readonly ViewMode[];

const PAPER_SIZES = ["A5", "A4", "A3", "A2", "A1", "A0"];
const ORIENTATIONS = ["landscape", "portrait"] as const;

/** Filter categories shown in the summary (`exports.panel.filters.categories.*`). */
type FilterCategory = "teams" | "users" | "projects" | "statuses" | "businessUnits" | "resources";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface ExportPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Lazy-mount wrapper: the panel body (which pulls `useProjects`,
 * `useUsers(activeOnly:false)`, etc.) is only loaded on the FIRST
 * `open=true`. Without it, the initial mount of /planning fires
 * a ~1 MB `/api/projects` + an archived=true `/api/users` even if
 * the user never opens the export.
 */
export function ExportPanel(props: ExportPanelProps) {
  const [hasBeenOpened, setHasBeenOpened] = useState(props.open);
  useEffect(() => {
    if (props.open && !hasBeenOpened) setHasBeenOpened(true);
  }, [props.open, hasBeenOpened]);
  if (!hasBeenOpened) return null;
  return <ExportPanelInner {...props} />;
}

function ExportPanelInner({ open, onOpenChange }: ExportPanelProps) {
  const t = useTranslations("exports.panel");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const { format } = useDateFormat();
  const [exportError, setExportError] = useState<string | null>(null);
  // Read directly from stores — changes update the planning in real time
  const { viewMode, setViewMode, startDate, endDate, sortMode, setSortMode, calendarMode, calendarUserId, calendarDays, selectedDay, calendarPersonalView } = usePlanningStore();
  const filters = useFilterStore();
  const { selectedBuIds } = useBuStore();
  // Merge header BU selector with filter store BU filter
  const effectiveBuIds = selectedBuIds.length > 0 ? selectedBuIds : filters.businessUnitIds;

  const { userId: currentUserId, user: currentUser, can } = usePermissions();
  // Same gate as the planning view (and the server export)
  const viewModes = VIEW_MODES.filter((v) => v !== "vehicles" || can("planning:view_vehicles"));

  const isPersonalMode = calendarMode === "personal";
  const isTeamDayMode = calendarMode === "team-day";
  const isVehicleMode = viewMode === "vehicles";
  const isCalendarMode = isPersonalMode || isTeamDayMode;
  const effectiveCalendarUserId = calendarUserId ?? currentUserId;

  type CellContent = "project" | "title" | "user-name" | "user-login";

  const [exportFormat, setExportFormat] = useState<ExportFormat>("excel");
  const [cellContent, setCellContent] = useState<CellContent>(
    viewMode === "projects" ? "user-name" : "project"
  );
  const [loading, setLoading] = useState(false);
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [includeStats, setIncludeStats] = useState(false);

  // Reset cellContent when viewMode changes
  useEffect(() => {
    setCellContent(viewMode === "projects" ? "user-name" : "project");
  }, [viewMode]);

  // PDF-only options (don't affect the planning)
  const [paperSize, setPaperSize] = useState("A4");
  const [orientation, setOrientation] = useState(isCalendarMode ? "portrait" : "landscape");
  const [pdfFormat, setPdfFormat] = useState(isCalendarMode ? "calendar" : "gantt");
  const [fitOnePage, setFitOnePage] = useState(false);

  const effectiveStartDate = isTeamDayMode ? selectedDay : startDate;
  const effectiveEndDate = isTeamDayMode ? selectedDay : endDate;
  const rangeLabel = isTeamDayMode
    ? format(selectedDay, "EEEE d MMMM yyyy")
    : `${format(startDate, "d MMM yyyy")} — ${format(endDate, "d MMM yyyy")}`;

  // Resolve calendar user name — calendarUserId is null when viewing own calendar
  const { data: calendarUser } = useUser(isPersonalMode && calendarUserId ? calendarUserId : null);
  const calendarUserName = isPersonalMode
    ? (calendarUserId ? calendarUser?.name : currentUser?.name) ?? "..."
    : null;

  // Resolve filter names from cached queries
  const { data: teams } = useTeams();
  const { data: allUsers } = useUsers(undefined, false);
  const { data: allProjects } = useProjects();
  const { data: statuses } = useStatuses();
  const { data: allPlaces } = usePlaces();
  const { data: allResources } = useResources();

  const activeFilters = useMemo(() => {
    const resolve = (ids: string[], items: NamedEntity[] | undefined) =>
      ids.map(id => items?.find((i) => i.id === id)?.name).filter(Boolean) as string[];

    const entries: { category: FilterCategory; names: string[] }[] = [];
    if (filters.teamIds.length) entries.push({ category: "teams", names: resolve(filters.teamIds, teams) });
    if (filters.userIds.length) entries.push({ category: "users", names: resolve(filters.userIds, allUsers) });
    if (filters.projectIds.length) entries.push({ category: "projects", names: resolve(filters.projectIds, allProjects) });
    if (filters.statusIds.length) entries.push({ category: "statuses", names: resolve(filters.statusIds, statuses) });
    if (effectiveBuIds.length) entries.push({ category: "businessUnits", names: resolve(effectiveBuIds, allPlaces) });
    if (filters.resourceIds.length) entries.push({ category: "resources", names: resolve(filters.resourceIds, allResources) });
    return entries;
  }, [filters.teamIds, filters.userIds, filters.projectIds, filters.statusIds, effectiveBuIds, filters.resourceIds, teams, allUsers, allProjects, statuses, allPlaces, allResources]);

  const buildQueryParams = useCallback((): string => {
    const params = new URLSearchParams();
    params.set("viewMode", isCalendarMode ? "users" : viewMode);
    params.set("startDate", toISODate(isTeamDayMode ? selectedDay : startDate));
    params.set("endDate", toISODate(isTeamDayMode ? selectedDay : endDate));
    params.set("sortMode", sortMode);
    params.set("cellContent", cellContent);
    if (filters.teamIds.length) params.set("teamIds", filters.teamIds.join(","));
    if (filters.userIds.length) params.set("userIds", filters.userIds.join(","));
    if (filters.projectIds.length) params.set("projectIds", filters.projectIds.join(","));
    if (filters.statusIds.length) params.set("statusIds", filters.statusIds.join(","));
    if (effectiveBuIds.length) params.set("businessUnitIds", effectiveBuIds.join(","));
    if (filters.resourceIds.length) params.set("resourceIds", filters.resourceIds.join(","));
    if (excludeWeekends) params.set("excludeWeekends", "1");
    if (includeStats && (exportFormat === "pdf" || exportFormat === "excel")) params.set("includeStats", "1");
    // Calendar mode params
    if (isPersonalMode) {
      params.set("calendarMode", "personal");
      if (effectiveCalendarUserId) params.set("calendarUserId", effectiveCalendarUserId);
      if (calendarDays) params.set("calendarDays", String(calendarDays));
    } else if (isTeamDayMode) {
      params.set("calendarMode", "team-day");
      params.set("selectedDay", toISODate(selectedDay));
    }
    if (exportFormat === "pdf") {
      params.set("paperSize", paperSize);
      params.set("orientation", orientation);
      params.set("format", pdfFormat);
      if (pdfFormat === "gantt" && fitOnePage) {
        params.set("fitOnePage", "1");
      }
      if (pdfFormat === "calendar" && isPersonalMode) {
        params.set("calendarView", calendarPersonalView);
      }
    }
    return params.toString();
  }, [viewMode, startDate, endDate, sortMode, cellContent, filters, exportFormat, paperSize, orientation, pdfFormat, fitOnePage, excludeWeekends, includeStats, calendarMode, calendarUserId, calendarDays, selectedDay, isPersonalMode, isTeamDayMode, isVehicleMode, isCalendarMode]);

  const handleExport = async () => {
    setLoading(true);
    setExportError(null);
    try {
      const url = `/api/export/${exportFormat}?${buildQueryParams()}`;
      const res = await fetch(url);
      await throwIfNotOk(res);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const ext = exportFormat === "excel" ? "xlsx" : exportFormat;
      const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
      // Neutral file names, identical in every language (i18n decision).
      const prefix = isPersonalMode ? "calendrier" : isTeamDayMode ? "journee" : isVehicleMode ? "vehicules" : "planning";
      a.download = `${prefix}_${today}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      // Message already translated by the server; network failure: generic message.
      setExportError(err instanceof ApiClientError ? err.message : te("network"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:w-[580px] sm:max-w-[580px] overflow-y-auto"
        overlayClassName="bg-black/10"
      >
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {/* Format selection */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t("format")}</Label>
            <div className="flex gap-2">
              {FORMAT_OPTIONS.map(({ value, icon: Icon, label }) => (
                <Button
                  key={value}
                  variant={exportFormat === value ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-9"
                  onClick={() => setExportFormat(value)}
                >
                  <Icon className="h-4 w-4 mr-1.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* Current planning settings (read from stores, editable) */}
          <div className="space-y-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {t("liveSettingsHint")}
            </p>

            {/* Calendar mode indicator */}
            {isCalendarMode && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 p-3 text-sm">
                <span className="font-medium text-blue-700 dark:text-blue-300">
                  {isPersonalMode
                    ? t("calendar.personal", { name: calendarUserName ?? "" })
                    : t("calendar.teamDay", { date: format(selectedDay, "EEEE d MMMM yyyy") })}
                </span>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  {t("calendar.hint")}
                </p>
              </div>
            )}

            {/* View mode — hidden in calendar mode (locked to users) */}
            {!isCalendarMode && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t("view")}</Label>
                <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {viewModes.map((v) => (
                      <SelectItem key={v} value={v}>{t(`views.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Sort mode */}
            {!isCalendarMode && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t("sort")}</Label>
                <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS_BY_VIEW[viewMode].map(mode => (
                      <SelectItem key={mode} value={mode}>{t(`sortModes.${SORT_LABEL_KEYS[mode]}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Cell content choice */}
            {exportFormat !== "csv" && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t("cellContent.label")}</Label>
                <Select value={cellContent} onValueChange={(v) => setCellContent(v as CellContent)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {viewMode === "projects" ? (
                      <>
                        <SelectItem value="user-name">{t("cellContent.userName")}</SelectItem>
                        <SelectItem value="user-login">{t("cellContent.userLogin")}</SelectItem>
                      </>
                    ) : isVehicleMode ? (
                      <>
                        <SelectItem value="project">{t("cellContent.projectOrType")}</SelectItem>
                        <SelectItem value="title">{t("cellContent.title")}</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="project">{t("cellContent.projectName")}</SelectItem>
                        <SelectItem value="title">{t("cellContent.taskTitle")}</SelectItem>
                        <SelectItem value="user-name">{t("cellContent.assigneeName")}</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Exclude weekends */}
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("excludeWeekends")}</Label>
              <Switch checked={excludeWeekends} onCheckedChange={setExcludeWeekends} />
            </div>

            {/* Include project stats (PDF / Excel only) */}
            {(exportFormat === "pdf" || exportFormat === "excel") && !isVehicleMode && (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-sm font-medium">{t("stats.label")}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {exportFormat === "excel" ? t("stats.helpExcel") : t("stats.helpPdf")}
                  </p>
                </div>
                <Switch checked={includeStats} onCheckedChange={setIncludeStats} />
              </div>
            )}

            {/* Summary: period */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {isTeamDayMode ? t("summary.day") : t("summary.period")}
                </span>
                <span className="font-medium">{rangeLabel}</span>
              </div>
              {!isCalendarMode && (
                <p className="text-xs text-muted-foreground">
                  {t("summary.periodHint")}
                </p>
              )}
            </div>

            {/* Summary: filters */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t("filters.title")}</span>
                <span className="font-medium">
                  {activeFilters.length > 0 ? t("filters.count", { count: activeFilters.length }) : tc("states.none")}
                </span>
              </div>
              {activeFilters.length > 0 && (
                <div className="space-y-1.5">
                  {activeFilters.map(({ category, names }) => (
                    <div key={category}>
                      <span className="text-xs text-muted-foreground">{t(`filters.categories.${category}`)}</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {names.map(name => (
                          <Badge key={name} variant="secondary" className="text-xs font-normal">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("filters.hint")}
              </p>
            </div>
          </div>

          {/* PDF specific options */}
          {exportFormat === "pdf" && (
            <div className="space-y-3 border-t pt-3">
              <Label className="text-sm font-medium text-muted-foreground">{t("pdf.title")}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("pdf.paperSize")}</Label>
                  <Select value={paperSize} onValueChange={setPaperSize}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAPER_SIZES.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("pdf.orientation")}</Label>
                  <Select value={orientation} onValueChange={setOrientation}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORIENTATIONS.map(o => (
                        <SelectItem key={o} value={o}>{t(`pdf.orientations.${o}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.viewType")}</Label>
                <Select value={pdfFormat} onValueChange={setPdfFormat}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {isCalendarMode && (
                      <SelectItem value="calendar">{t("pdf.viewTypes.calendar")}</SelectItem>
                    )}
                    <SelectItem value="gantt">{t("pdf.viewTypes.gantt")}</SelectItem>
                    <SelectItem value="list">{t("pdf.viewTypes.list")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {pdfFormat === "gantt" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.fitOnePage")}</Label>
                  <Switch checked={fitOnePage} onCheckedChange={setFitOnePage} />
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter>
          {exportError && (
            <p className="text-sm text-destructive px-4" role="alert">{exportError}</p>
          )}
          <div className="flex gap-2 w-full px-4">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1">
              {tc("actions.cancel")}
            </Button>
            <Button onClick={handleExport} disabled={loading} className="flex-1">
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {loading ? t("generating") : tc("actions.download")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
