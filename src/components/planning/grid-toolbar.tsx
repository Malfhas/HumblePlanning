"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePlanningStore, type ViewMode, type ZoomLevel, type SortMode, type CalendarMode } from "@/stores/planning-store";
import { useFilterStore } from "@/stores/filter-store";
import { usePermissions } from "@/hooks/use-permissions";
import { useConfig } from "@/hooks/use-config";
import { useUsers } from "@/hooks/use-users";
import { useBuStore } from "@/stores/bu-store";
import { FilterPanel } from "./filter-panel";
import { ExportPanel } from "./export-panel";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { PresenceBar } from "./presence-bar";
import { cn } from "@/lib/utils";
import { LiveStatusBadge } from "./live-status-badge";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
  FolderKanban,
  MapPin,
  Wrench,
  Truck,
  ZoomIn,
  ZoomOut,
  MoveHorizontal,
  Filter,
  Settings2,
  Plus,
  Clock,
  ArrowUpDown,
  Download,
  LayoutGrid,
  Check,
  ChevronsUpDown,
  MoreHorizontal,
  ChevronUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { tDyn } from "@/i18n/dynamic";

// i18n-dynamic: planning.toolbar.viewModes.*
// i18n-dynamic: planning.toolbar.calendarModes.*
// i18n-dynamic: planning.toolbar.sort.*

const VIEW_OPTIONS: { mode: ViewMode; icon: typeof Users; labelKey: string }[] = [
  { mode: "users", icon: Users, labelKey: "users" },
  { mode: "projects", icon: FolderKanban, labelKey: "projects" },
];

const ZOOM_ORDER: ZoomLevel[] = ["compact", "normal", "large", "xlarge", "xxlarge"];

const CALENDAR_OPTIONS: { mode: CalendarMode; icon: typeof LayoutGrid; labelKey: string }[] = [
  { mode: "off", icon: LayoutGrid, labelKey: "planning" },
  { mode: "personal", icon: CalendarDays, labelKey: "personal" },
  { mode: "team-day", icon: Users, labelKey: "teamDay" },
];

const CALENDAR_DAYS_OPTIONS = [1, 3, 5, 7] as const;

/** Sort mode → key `planning.toolbar.sort.<key>` (label translated at render time). */
const SORT_LABEL_KEYS: Record<SortMode, string> = {
  // Flat alphabetical
  "name-asc": "nameAsc",
  "name-desc": "nameDesc",
  // Users view
  "custom": "custom",
  "team-alpha-custom": "teamAlphaCustom",
  "team-name-asc": "teamNameAsc",
  "team-name-desc": "teamNameDesc",
  "custom-bu": "customBu",
  "custom-bu-team": "customBuTeam",
  "custom-bu-user": "customBuUser",
  // Projects view
  "custom-group": "customGroup",
  "group-alpha-custom": "groupAlphaCustom",
  "group-name-asc": "groupNameAsc",
  "group-name-desc": "groupNameDesc",
  "custom-bu-group": "customBuGroup",
  "custom-bu-group-alpha": "customBuGroupAlpha",
  // Resources / vehicles
  "type-name-asc": "typeNameAsc",
  "type-name-desc": "typeNameDesc",
};

const SORT_OPTIONS_BY_VIEW: Record<ViewMode, SortMode[]> = {
  users: ["custom", "team-alpha-custom", "team-name-asc", "team-name-desc", "custom-bu-user", "custom-bu-team", "custom-bu", "name-asc", "name-desc"],
  projects: ["custom-group", "group-alpha-custom", "group-name-asc", "group-name-desc", "custom-bu-group", "custom-bu-group-alpha", "name-asc", "name-desc"],
  places: ["name-asc", "name-desc"],
  resources: ["type-name-asc", "type-name-desc", "name-asc", "name-desc"],
  vehicles: ["type-name-asc", "type-name-desc", "name-asc", "name-desc"],
};

interface GridToolbarProps {
  onCreateTask: () => void;
}

/** "Column width" button that opens a popover with a granular
 *  slider. On screens < 768 px, the slider max bound is capped
 *  at `mobileMax` (admin setting). The user pref stays persisted intact
 *  in the store — only the display cap adapts. */
function CellWidthSliderButton({
  cellWidth,
  range,
  mobileMax,
  onChange,
}: {
  cellWidth: number;
  range: { min: number; max: number };
  mobileMax: number;
  onChange: (value: number) => void;
}) {
  const t = useTranslations("planning.toolbar.cellWidth");
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const effectiveMax = isMobile ? Math.min(range.max, mobileMax) : range.max;
  const sliderValue = Math.min(cellWidth, effectiveMax);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="size-8">
              <MoveHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("label")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {t("label")}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {sliderValue}px
            </span>
          </div>
          <Slider
            min={range.min}
            max={effectiveMax}
            step={1}
            value={[sliderValue]}
            onValueChange={(values) => onChange(values[0])}
          />
          {isMobile && cellWidth > mobileMax && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              {t("mobileCap", { max: mobileMax, width: cellWidth })}
            </p>
          )}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              onClick={() => onChange(range.min)}
            >
              <ZoomOut className="h-3 w-3" /> {t("compact")}
            </button>
            <button
              type="button"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              onClick={() => onChange(effectiveMax)}
            >
              {t("wide")} <ZoomIn className="h-3 w-3" />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function GridToolbar({ onCreateTask }: GridToolbarProps) {
  const t = useTranslations("planning.toolbar");
  const tCommon = useTranslations("common");
  const { format: formatLocalized, intlTag } = useDateFormat();
  const {
    viewMode,
    setViewMode,
    startDate,
    endDate,
    zoomLevel,
    setZoomLevel,
    cellWidth,
    setCellWidth,
    getCellWidthRange,
    getMobileMaxCellWidth,
    setDateRange,
    goToToday,
    showSummary,
    toggleSummary,
    showUserCount,
    toggleUserCount,
    showFileIcon,
    toggleFileIcon,
    showRowAvatar,
    toggleRowAvatar,
    columnMode,
    setColumnMode,
    selectedDay,
    setSelectedDay,
    navigateDayForward,
    navigateDayBackward,
    sortMode,
    setSortMode,
    calendarMode,
    setCalendarMode,
    calendarDays,
    setCalendarDays,
    calendarUserId,
    setCalendarUserId,
    calendarShow24h,
    toggleCalendar24h,
    calendarPersonalView,
    setCalendarPersonalView,
  } = usePlanningStore();

  const { userId: currentUserId, can, canCreateAnyTask } = usePermissions();
  const { data: config } = useConfig();
  const vehiclesEnabled = config?.MODULE_VEHICLES !== "false";
  const resourcesEnabled = config?.MODULE_RESOURCES !== "false";

  // Planning view permissions
  const canViewCalendar = can("planning:view_calendar");
  const canViewTeamDay = can("planning:view_team_day");
  const canViewVehicles = can("planning:view_vehicles");
  const canViewResources = can("planning:view_resources");
  const canExport = can("export:use");
  const canCreate = canCreateAnyTask;
  const { data: allPlanningUsers } = useUsers(undefined, true);
  const { selectedBuIds } = useBuStore();
  const planningUsers = useMemo(() => {
    if (selectedBuIds.length === 0 || !allPlanningUsers) return allPlanningUsers;
    return allPlanningUsers.filter((u: any) => u.businessUnitId && selectedBuIds.includes(u.businessUnitId));
  }, [allPlanningUsers, selectedBuIds]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  const [userSelectorOpen, setUserSelectorOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // On mobile, the 2nd toolbar (Sort / Export / Display / Days&Hours)
  // AND the view / grouping selectors of the 1st bar are hidden
  // by default. The user expands them through a menu button placed in the
  // 1st bar. Filters + Column width always stay visible next to
  // the date.
  //
  // The state is PERSISTED in `localStorage` because the toolbar is
  // remounted by the parent when some store values change
  // (e.g. switching Days ↔ Hours, which renders a different tree). Without
  // persistence, the menu closed after every user action.
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("planning-mobile-menu-open") === "true";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("planning-mobile-menu-open", String(mobileMenuOpen));
  }, [mobileMenuOpen]);
  // Track last non-vehicles/resources viewMode to restore when switching back
  const lastViewModeRef = useRef<ViewMode>(viewMode === "vehicles" || viewMode === "resources" ? "users" : viewMode);
  if (viewMode !== "vehicles" && viewMode !== "resources") lastViewModeRef.current = viewMode;
  const isVehiclesView = viewMode === "vehicles";
  const isResourcesView = viewMode === "resources";
  const isAssetView = isVehiclesView || isResourcesView;
  const activeFilterCount = useFilterStore((s) =>
    [s.teamIds.length, s.userIds.length, s.projectIds.length, s.statusIds.length,
     s.businessUnitIds.length, s.siteAddressIds.length, s.resourceIds.length, s.vehicleIds.length,
     s.qualificationIds.length, s.groupIds.length, s.search ? 1 : 0].filter(n => n > 0).length
  );
  const hasFilters = activeFilterCount > 0;
  const zoomIdx = ZOOM_ORDER.indexOf(zoomLevel);
  const isHourMode = columnMode === "hours";
  const isDayNavigation = isHourMode || calendarMode === "team-day";

  // Uppercase on the first letter only (« Vendredi 30 octobre 2026 »,
  // like the canvas header): the CSS `capitalize` class uppercased
  // every word (« Octobre »), which is wrong in French.
  const capitalizeFirst = (s: string) => s.charAt(0).toLocaleUpperCase(intlTag) + s.slice(1);
  const dayLabel = capitalizeFirst(formatLocalized(selectedDay, "EEEE d MMMM yyyy"));
  // Compact version for mobile (« Ven. 30 oct. » / « Fri 30 Oct »), like
  // the short label of the period selector.
  const dayLabelShort = capitalizeFirst(formatLocalized(selectedDay, "EEE d MMM"));

  const handleToggleColumnMode = useCallback(() => {
    // When switching to the hours view, reset the selected day to
    // the 1st day of the current period (otherwise the previous
    // selectedDay, possibly outside the current window, would be kept).
    if (!isHourMode) {
      setSelectedDay(startDate);
    }
    setColumnMode(isHourMode ? "days" : "hours");
  }, [isHourMode, setColumnMode, setSelectedDay, startDate]);

  const handleDayPickerSelect = useCallback((day: Date | undefined) => {
    if (day) {
      setSelectedDay(day);
      setDayPickerOpen(false);
    }
  }, [setSelectedDay]);

  const showViewModeButtons = !isAssetView && calendarMode === "off";
  const showColumnToggle = calendarMode === "off" && !isAssetView;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="border-b bg-background">
        {/* ═══ Row 1 — "What am I looking at" ═══
            Mobile: the date nav and the mini-toolbar stay on the first
            row (nav with `flex-1 basis-0`: it takes the remaining space
            and its label truncates instead of wrapping under the buttons);
            the calendar sub-options wrap to the next row (`order-last
            basis-full`). Desktop: flex-wrap to absorb the many
            icons/labels. */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 md:px-4">
          {/* Time navigation — flex-1 + min-w-0 on mobile so the
              date label truncates; natural size on desktop. */}
          <div data-planning-date-nav className="flex flex-1 md:flex-initial items-center gap-1 min-w-0">
            {isDayNavigation ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="size-8" onClick={navigateDayBackward}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("previousDay")}</TooltipContent>
                </Tooltip>
                <Button variant="outline" size="sm" className="h-8 px-2 text-xs md:px-3 md:text-sm" onClick={() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  setSelectedDay(today);
                }}>
                  <CalendarDays className="mr-1 h-4 w-4 hidden sm:inline-block" />
                  <span className="sm:hidden">{t("todayShort")}</span>
                  <span className="hidden sm:inline">{tCommon("time.today")}</span>
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="size-8" onClick={navigateDayForward}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("nextDay")}</TooltipContent>
                </Tooltip>

                <Popover open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 min-w-0 shrink px-2 text-xs text-muted-foreground hover:text-foreground md:text-sm">
                      <span className="truncate md:hidden">{dayLabelShort}</span>
                      <span className="hidden truncate md:inline">{dayLabel}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
                    <Calendar
                      mode="single"
                      selected={selectedDay}
                      onSelect={handleDayPickerSelect}
                      defaultMonth={selectedDay}
                      weekStartsOn={1}
                      showOutsideDays={false}
                    />
                  </PopoverContent>
                </Popover>
              </>
            ) : (
              <DateRangePicker startDate={startDate} endDate={endDate} onChange={setDateRange} onGoToToday={goToToday} />
            )}
          </div>

          {/* Separator (hidden on mobile since the following modes/views move to the expandable bar) */}
          <div className="hidden md:block w-px h-5 bg-border" />

          {/* Display mode: Schedule | My calendar | Team/day | Vehicles | Resources
              Hidden on mobile (moved to the 2nd expandable bar). */}
          <div className="hidden md:flex items-center gap-0.5 md:gap-1">
            {CALENDAR_OPTIONS.map(({ mode, icon: Icon, labelKey }) => {
              const label = tDyn(t, `calendarModes.${labelKey}`);
              // "off" (Planning) is always available. Others require specific permissions.
              const permMap: Record<string, boolean> = {
                off: true,
                personal: canViewCalendar,
                "team-day": canViewTeamDay,
              };
              const allowed = permMap[mode] ?? true;
              return (
                <Tooltip key={mode}>
                  <TooltipTrigger asChild>
                    <span tabIndex={!allowed ? 0 : undefined}>
                    <Button
                      variant={!isAssetView && calendarMode === mode ? "default" : "ghost"}
                      size="sm"
                      className="h-8 px-2 md:px-3"
                      disabled={!allowed}
                      onClick={allowed ? () => {
                        if (isAssetView) setViewMode(lastViewModeRef.current);
                        setCalendarMode(mode);
                      } : undefined}
                    >
                      <Icon className="h-4 w-4 md:mr-1" />
                      <span className="hidden md:inline text-xs">{label}</span>
                    </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {allowed ? label : t("permissionDenied")}
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {(vehiclesEnabled || resourcesEnabled) && (
              <div className="w-px h-5 bg-border mx-0.5" />
            )}

            {vehiclesEnabled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={!canViewVehicles ? 0 : undefined}>
                  <Button
                    variant={isVehiclesView ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-2 md:px-3"
                    disabled={!canViewVehicles}
                    onClick={canViewVehicles ? () => {
                      if (isVehiclesView) {
                        setViewMode(lastViewModeRef.current);
                      } else {
                        setCalendarMode("off");
                        setViewMode("vehicles");
                      }
                    } : undefined}
                  >
                    <Truck className="h-4 w-4 md:mr-1" />
                    <span className="hidden md:inline text-xs">{tCommon("entities.vehicles")}</span>
                  </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {canViewVehicles ? tCommon("entities.vehicles") : t("permissionDenied")}
                </TooltipContent>
              </Tooltip>
            )}

            {resourcesEnabled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={!canViewResources ? 0 : undefined}>
                  <Button
                    variant={isResourcesView ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-2 md:px-3"
                    disabled={!canViewResources}
                    onClick={canViewResources ? () => {
                      if (isResourcesView) {
                        setViewMode(lastViewModeRef.current);
                      } else {
                        setCalendarMode("off");
                        setViewMode("resources");
                      }
                    } : undefined}
                  >
                    <Wrench className="h-4 w-4 md:mr-1" />
                    <span className="hidden md:inline text-xs">{tCommon("entities.resources")}</span>
                  </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {canViewResources ? tCommon("entities.resources") : t("permissionDenied")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Personal calendar sub-options (inline after the modes; on
              mobile, on their own row under the date nav) */}
          {calendarMode === "personal" && !isAssetView && (
            <div className="order-last flex basis-full flex-wrap items-center gap-1 md:order-none md:basis-auto md:flex-nowrap">
              <div className="hidden md:block w-px h-5 bg-border" />

              {/* User selector */}
              <Popover open={userSelectorOpen} onOpenChange={setUserSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 md:px-3 text-xs justify-between min-w-[180px]"
                  >
                    <span className="truncate max-w-[160px]">
                      {(() => {
                        const effectiveId = calendarUserId ?? currentUserId;
                        const user = planningUsers?.find((u) => u.id === effectiveId);
                        return user ? user.name : t("calendar.selectUser");
                      })()}
                    </span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start" onWheel={handleWheel}>
                  <Command>
                    <CommandInput placeholder={tCommon("actions.searchPlaceholder")} />
                    <CommandList onWheel={handleWheel}>
                      <CommandEmpty>{t("calendar.noUser")}</CommandEmpty>
                      <CommandGroup>
                        {(planningUsers ?? []).sort((a, b) => {
                          if (a.id === currentUserId) return -1;
                          if (b.id === currentUserId) return 1;
                          return 0;
                        }).map((user) => {
                          const effectiveId = calendarUserId ?? currentUserId;
                          return (
                            <CommandItem
                              key={user.id}
                              value={user.id}
                              keywords={[user.name]}
                              onSelect={() => {
                                setCalendarUserId(user.id === currentUserId ? null : user.id);
                                setUserSelectorOpen(false);
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${effectiveId === user.id ? "opacity-100" : "opacity-0"}`}
                              />
                              {user.name}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* View toggle: hours / days */}
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={calendarPersonalView === "hours" ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setCalendarPersonalView("hours")}
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("calendar.hoursView")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={calendarPersonalView === "days" ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setCalendarPersonalView("days")}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("calendar.daysView")}</TooltipContent>
                </Tooltip>
              </div>

              {/* Days selector */}
              <div className="flex items-center gap-0.5">
                {CALENDAR_DAYS_OPTIONS.map((d) => (
                  <Button
                    key={d}
                    variant={calendarDays === d ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setCalendarDays(d)}
                  >
                    {t("calendar.daysShort", { count: d })}
                  </Button>
                ))}
              </div>

              {/* 24h toggle (only in hours view) */}
              {calendarPersonalView === "hours" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={calendarShow24h ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={toggleCalendar24h}
                    >
                      24h
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {calendarShow24h ? t("calendar.showWorkingHours") : t("calendar.show24h")}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {/* Team/day sub-option: 24h toggle (on mobile, on its
              own row under the date nav) */}
          {calendarMode === "team-day" && !isAssetView && (
            <div className="order-last flex basis-full items-center gap-1 md:order-none md:basis-auto">
              <div className="hidden md:block w-px h-5 bg-border" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={calendarShow24h ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={toggleCalendar24h}
                  >
                    24h
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {calendarShow24h ? t("calendar.showWorkingHours") : t("calendar.show24h")}
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Spacer (desktop; on mobile the mini-toolbar is pushed to the
              right by `ml-auto` and the date nav takes the remaining space) */}
          <div className="hidden md:block flex-1" />

          {/* Rows by (grouping) — hidden in Vehicles and Team/day.
              Hidden on mobile (moved to the 2nd expandable bar). */}
          {showViewModeButtons && (
            <div className="hidden md:flex items-center gap-0.5 md:gap-1">
              {VIEW_OPTIONS.map(({ mode, icon: Icon, labelKey }) => (
                <Tooltip key={mode}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={viewMode === mode ? "default" : "ghost"}
                      size="sm"
                      className="h-8 px-2 md:px-3"
                      onClick={() => setViewMode(mode)}
                    >
                      <Icon className="h-4 w-4 md:mr-1" />
                      <span className="hidden md:inline text-xs">{tDyn(t, `viewModes.${labelKey}`)}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="md:hidden">
                    {tDyn(t, `viewModes.${labelKey}`)}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}

          {/*
            MOBILE-ONLY mini-toolbar stuck to the right of the date bar:
            - Filters (funnel): always visible, opens the FilterPanel
            - Column width (CellWidthSliderButton): always visible
            - Menu button: expands/collapses the 2nd bar (views, grouping, tools)
          */}
          <div data-planning-mobile-tools className="flex md:hidden items-center gap-1 ml-auto shrink-0">
            <Button
              variant="outline"
              size="icon"
              className={cn(
                "size-8",
                hasFilters &&
                  "border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300 dark:hover:bg-orange-900",
              )}
              onClick={() => setFilterOpen(true)}
              aria-label={t("filters")}
            >
              <Filter className="h-4 w-4" />
              {hasFilters && (
                <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-orange-500 text-white hover:bg-orange-500">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
            <CellWidthSliderButton
              cellWidth={cellWidth}
              range={getCellWidthRange()}
              mobileMax={getMobileMaxCellWidth()}
              onChange={setCellWidth}
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? t("hideMenu") : t("showMenu")}
            >
              {mobileMenuOpen ? <ChevronUp className="h-4 w-4" /> : <MoreHorizontal className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* ═══ Row 2 — "Tools & actions" ═══
            On mobile, hidden by default (mobileMenuOpen = false).
            On desktop (md+), always visible. */}
        <div className={cn(
          "flex-wrap items-center gap-2 border-t border-border/50 px-3 py-1.5 md:px-4 md:flex",
          mobileMenuOpen ? "flex" : "hidden",
        )}>
          {/* MOBILE-ONLY: Display modes (Schedule, My calendar, Team/day, Veh., Res.)
              and Grouping moved here from row 1 (saves space on mobile). */}
          <div className="flex md:hidden items-center gap-0.5 w-full border-b border-border/30 pb-1.5 mb-1">
            {CALENDAR_OPTIONS.map(({ mode, icon: Icon, labelKey }) => {
              const label = tDyn(t, `calendarModes.${labelKey}`);
              const permMap: Record<string, boolean> = {
                off: true,
                personal: canViewCalendar,
                "team-day": canViewTeamDay,
              };
              const allowed = permMap[mode] ?? true;
              if (!allowed) return null;
              return (
                <Button
                  key={mode}
                  variant={calendarMode === mode ? "default" : "ghost"}
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setCalendarMode(mode)}
                  aria-label={label}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
            {showViewModeButtons && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                {VIEW_OPTIONS.map(({ mode, icon: Icon, labelKey }) => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setViewMode(mode)}
                    aria-label={tDyn(t, `viewModes.${labelKey}`)}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                ))}
              </>
            )}
          </div>

          {/* + New task */}
          {!canCreate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="default" size="sm" className="h-8" disabled>
                    <Plus className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">{t("newTask")}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("permissionDenied")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="default" size="sm" className="h-8" onClick={onCreateTask}>
              <Plus className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">{t("newTask")}</span>
            </Button>
          )}

          {/* Presence */}
          <PresenceBar />

          {/* Real-time Socket.io status indicator */}
          <LiveStatusBadge />

          {/* Spacer */}
          <div className="flex-1" />

          {/* Days/Hours toggle — hidden in My calendar and Vehicles */}
          {showColumnToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isHourMode ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-2 md:px-3"
                  onClick={handleToggleColumnMode}
                >
                  <Clock className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline text-xs">{isHourMode ? t("columnMode.hours") : t("columnMode.days")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isHourMode ? t("columnMode.switchToDays") : t("columnMode.switchToHours")}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2 md:px-3">
                <ArrowUpDown className="h-4 w-4 md:mr-1" />
                <span className="hidden md:inline text-xs">{t("sortLabel")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                {SORT_OPTIONS_BY_VIEW[viewMode].map((mode) => (
                  <DropdownMenuRadioItem key={mode} value={mode}>
                    {tDyn(t, `sort.${SORT_LABEL_KEYS[mode]}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Filters — hidden on mobile since duplicated in the mini-toolbar right of the date bar */}
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "hidden md:flex h-8 px-2 md:px-3",
              hasFilters &&
                "border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300 dark:hover:bg-orange-900",
            )}
            onClick={() => setFilterOpen(true)}
          >
            <Filter className="h-4 w-4 md:mr-1" />
            <span className="hidden md:inline text-xs">{t("filters")}</span>
            {hasFilters && <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-orange-500 text-white hover:bg-orange-500">{activeFilterCount}</Badge>}
          </Button>
          <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} />

          {/* Export */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={!canExport ? 0 : undefined}>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 md:px-3"
                disabled={!canExport}
                onClick={canExport ? () => setExportOpen(true) : undefined}
              >
                <Download className="h-4 w-4 md:mr-1" />
                <span className="hidden md:inline text-xs">{t("export")}</span>
              </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {canExport ? tCommon("actions.export") : t("permissionDenied")}
            </TooltipContent>
          </Tooltip>
          <ExportPanel open={exportOpen} onOpenChange={setExportOpen} />

          {/* Options */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 md:px-2.5">
                    <Settings2 className="h-4 w-4" />
                    <span className="hidden md:inline text-xs">{t("display.label")}</span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="md:hidden">
                {t("display.tooltip")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={showSummary}
                onCheckedChange={toggleSummary}
              >
                {t("display.showSummary")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showUserCount}
                onCheckedChange={toggleUserCount}
              >
                {t("display.userCountIcon")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showFileIcon}
                onCheckedChange={toggleFileIcon}
              >
                {t("display.fileIcon")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showRowAvatar}
                onCheckedChange={toggleRowAvatar}
              >
                {t("display.rowAvatar")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Zoom — popover with a granular slider.
              Hidden on mobile since duplicated in the date bar mini-toolbar. */}
          <div className="hidden md:block">
            <CellWidthSliderButton
              cellWidth={cellWidth}
              range={getCellWidthRange()}
              mobileMax={getMobileMaxCellWidth()}
              onChange={setCellWidth}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
