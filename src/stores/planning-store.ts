"use client";

import { create } from "zustand";
import { addDays, addMonths } from "date-fns";

import type { ViewMode, ZoomLevel, ColumnMode, SortMode, CalendarMode } from "@/lib/types/planning";
export type { ViewMode, ZoomLevel, ColumnMode, SortMode, CalendarMode } from "@/lib/types/planning";

interface PlanningState {
  // View settings
  viewMode: ViewMode;
  startDate: Date;
  endDate: Date;
  cellWidth: number;
  slotWidth: number;
  zoomLevel: ZoomLevel;
  rowHeight: number;

  // Column mode (days vs hours)
  columnMode: ColumnMode;
  selectedDay: Date;

  // Sort
  sortMode: SortMode;

  // Calendar mode
  calendarMode: CalendarMode;
  calendarDays: number;
  calendarUserId: string | null;
  calendarShow24h: boolean;
  calendarPersonalView: "hours" | "days";

  // Display options
  showSummary: boolean;
  showUserCount: boolean;
  showFileIcon: boolean;
  showRowAvatar: boolean;

  // Selection
  selectedTaskId: string | null;
  selectedRowId: string | null;

  // Drag state
  isDragging: boolean;
  dragTaskId: string | null;
  dragStartDate: string | null;

  // Clipboard
  clipboardTask: { taskId: string; mode: "copy" | "cut" } | null;

  // Drag hover
  dragOverCellId: string | null;
  dragTaskHours: number; // duration of dragged task in hours (for multi-cell highlight)

  // Resize preview (calendar view)
  resizePreview: { columnId: string; dateStr?: string; startHour: number; endHour: number } | null;

  // Resize state (gantt view)
  ganttResizeActive: boolean;
  ganttResizePreview: { rowId: string; startDate: string; endDate: string } | null;

  // Pending drop (ghost preview while waiting for user action)
  pendingDrop: {
    taskId: string;
    newStartDate: string;
    newEndDate?: string;
    newStartTime?: string;
    newEndTime?: string;
    targetRowId?: string;
  } | null;

  // Deleting task animation
  deletingTaskIds: Set<string>;

  // Config-based default months
  _configMonths: number | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setDateRange: (start: Date, end: Date) => void;
  /** Kept for backward compatibility — used by calendar-grid to
   *  map onto SLOT_HEIGHTS[level]. The value is derived automatically
   *  from the position of `cellWidth` within [min, max]. */
  setZoomLevel: (level: ZoomLevel) => void;
  /** Column width setting through the slider (in px). Clamps within the
   *  admin range [min, max] and persists as is. The derived `zoomLevel`
   *  is recomputed to stay consistent with calendar-grid. */
  setCellWidth: (width: number) => void;
  /** Current min/max range of the slider (read from the admin config). */
  getCellWidthRange: () => { min: number; max: number };
  /** Mobile cap (admin config) — applied in the UI when `window.innerWidth < 768`. */
  getMobileMaxCellWidth: () => number;
  /** Re-applies the effective cellWidth based on `window.innerWidth` (without
   *  overwriting the user pref in localStorage). Call it on mount and on resize. */
  applyMobileCap: () => void;
  setSelectedTask: (id: string | null) => void;
  setSelectedRow: (id: string | null) => void;
  setDragState: (isDragging: boolean, taskId?: string | null, startDate?: string | null) => void;
  setClipboard: (taskId: string, mode: "copy" | "cut") => void;
  clearClipboard: () => void;
  setDragOverCell: (id: string | null) => void;
  setDragTaskHours: (hours: number) => void;
  setResizePreview: (preview: { columnId: string; dateStr?: string; startHour: number; endHour: number } | null) => void;
  setGanttResizeActive: (active: boolean) => void;
  setGanttResizePreview: (preview: { rowId: string; startDate: string; endDate: string } | null) => void;
  setPendingDrop: (drop: { taskId: string; newStartDate: string; newEndDate?: string; newStartTime?: string; newEndTime?: string; targetRowId?: string } | null) => void;
  markTaskDeleting: (taskId: string) => void;
  toggleSummary: () => void;
  toggleUserCount: () => void;
  toggleFileIcon: () => void;
  toggleRowAvatar: () => void;
  navigateForward: () => void;
  navigateBackward: () => void;
  goToToday: () => void;
  setSortMode: (mode: SortMode) => void;
  setColumnMode: (mode: ColumnMode) => void;
  setSelectedDay: (day: Date) => void;
  navigateDayForward: () => void;
  navigateDayBackward: () => void;
  initFromConfig: (
    months: number,
    cellWidthConfig?: { min?: number; max?: number; defaultW?: number; mobileMax?: number },
  ) => void;
  applyUserDefaults: (defaults: { viewMode?: string; columnMode?: string }) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  setCalendarDays: (days: number) => void;
  setCalendarUserId: (userId: string | null) => void;
  toggleCalendar24h: () => void;
  setCalendarPersonalView: (view: "hours" | "days") => void;
}

// Default bounds (overridden by the admin settings through `initFromConfig`).
// These values are only used when the DB config is missing — the source of
// truth remains the "Planning display" settings.
const DEFAULT_CELL_MIN = 55;
const DEFAULT_CELL_MAX = 170;
const DEFAULT_CELL_FALLBACK = 75;
const DEFAULT_CELL_MOBILE_MAX = 140;

// Current bounds (mutable — re-read from the DB on mount through initFromConfig).
let CELL_MIN = DEFAULT_CELL_MIN;
let CELL_MAX = DEFAULT_CELL_MAX;
let CELL_DEFAULT = DEFAULT_CELL_FALLBACK;
let CELL_MOBILE_MAX = DEFAULT_CELL_MOBILE_MAX;

const ZOOM_LEVELS: ZoomLevel[] = ["compact", "normal", "large", "xlarge", "xxlarge"];

/** Ratio of hour slot width / day cell width. Lets the cellWidth slider
 *  also drive the hours view without a separate admin setting. */
const SLOT_TO_CELL_RATIO = 1.7;

/** Maps a zoom step (used by calendar-grid) onto a cellWidth within the
 *  current [min, max] range. 5 evenly spaced steps. */
function cellWidthFromZoomLevel(level: ZoomLevel): number {
  const idx = ZOOM_LEVELS.indexOf(level);
  if (idx < 0) return CELL_DEFAULT;
  const t = idx / (ZOOM_LEVELS.length - 1);
  return Math.round(CELL_MIN + t * (CELL_MAX - CELL_MIN));
}

/** Inverse: from a cellWidth, finds the closest zoom step. */
function zoomLevelFromCellWidth(width: number): ZoomLevel {
  if (CELL_MAX <= CELL_MIN) return "normal";
  const t = Math.max(0, Math.min(1, (width - CELL_MIN) / (CELL_MAX - CELL_MIN)));
  const idx = Math.round(t * (ZOOM_LEVELS.length - 1));
  return ZOOM_LEVELS[idx]!;
}

const STORAGE_KEY = "humble-planning-zoom";
const CELL_WIDTH_KEY = "humble-planning-cell-width";
const SUMMARY_KEY = "humble-planning-summary";
const USER_COUNT_KEY = "humble-planning-user-count";
const FILE_ICON_KEY = "humble-planning-file-icon";
const ROW_AVATAR_KEY = "humble-planning-row-avatar";
const DATE_RANGE_KEY = "humble-planning-date-range";
const SORT_KEY_PREFIX = "humble-planning-sort-";
const CALENDAR_MODE_KEY = "humble-planning-calendar-mode";
const VIEW_MODE_KEY = "humble-planning-view-mode";
const COLUMN_MODE_KEY = "humble-planning-column-mode";
const SELECTED_DAY_KEY = "humble-planning-selected-day";

const VALID_CALENDAR_MODES: CalendarMode[] = ["off", "personal", "team-day"];

function getSavedCalendarMode(): CalendarMode {
  if (typeof window === "undefined") return "off";
  const saved = localStorage.getItem(CALENDAR_MODE_KEY);
  if (saved && VALID_CALENDAR_MODES.includes(saved as CalendarMode)) return saved as CalendarMode;
  return "off";
}

const VALID_SORT_MODES: Record<ViewMode, SortMode[]> = {
  users: ["custom", "team-alpha-custom", "team-name-asc", "team-name-desc", "custom-bu-user", "custom-bu-team", "custom-bu", "name-asc", "name-desc"],
  projects: ["custom-group", "group-alpha-custom", "group-name-asc", "group-name-desc", "custom-bu-group", "custom-bu-group-alpha", "name-asc", "name-desc"],
  places: ["name-asc", "name-desc"],
  resources: ["type-name-asc", "type-name-desc", "name-asc", "name-desc"],
  vehicles: ["type-name-asc", "type-name-desc", "name-asc", "name-desc"],
};

const DEFAULT_SORT: Record<ViewMode, SortMode> = {
  users: "custom",
  projects: "custom-group",
  places: "name-asc",
  resources: "type-name-asc",
  vehicles: "type-name-asc",
};

function getSavedSort(viewMode: ViewMode): SortMode {
  if (typeof window === "undefined") return DEFAULT_SORT[viewMode];
  const saved = localStorage.getItem(SORT_KEY_PREFIX + viewMode);
  if (saved && VALID_SORT_MODES[viewMode].includes(saved as SortMode)) return saved as SortMode;
  return DEFAULT_SORT[viewMode];
}

const VALID_VIEW_MODES: ViewMode[] = ["users", "projects", "places", "resources", "vehicles"];
const VALID_COLUMN_MODES: ColumnMode[] = ["days", "hours"];

function getSavedViewMode(): ViewMode {
  if (typeof window === "undefined") return "users";
  const saved = localStorage.getItem(VIEW_MODE_KEY);
  if (saved && VALID_VIEW_MODES.includes(saved as ViewMode)) return saved as ViewMode;
  return "users";
}

function getSavedColumnMode(): ColumnMode {
  if (typeof window === "undefined") return "days";
  const saved = localStorage.getItem(COLUMN_MODE_KEY);
  if (saved && VALID_COLUMN_MODES.includes(saved as ColumnMode)) return saved as ColumnMode;
  return "days";
}

function getSavedCellWidth(): number | null {
  if (typeof window === "undefined") return null;
  const saved = localStorage.getItem(CELL_WIDTH_KEY);
  if (!saved) return null;
  const n = parseInt(saved, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Migration: if the user has no `humble-planning-cell-width` but
 *  has a legacy `humble-planning-zoom`, convert the zoom step to a cellWidth
 *  and persist it. On the next reload, only the cellWidth is read. */
function migrateLegacyZoom(): number | null {
  if (typeof window === "undefined") return null;
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (!legacy || !ZOOM_LEVELS.includes(legacy as ZoomLevel)) return null;
  const width = cellWidthFromZoomLevel(legacy as ZoomLevel);
  localStorage.setItem(CELL_WIDTH_KEY, String(width));
  return width;
}

function getTodayRange(months = 2) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { start: today, end: addDays(addMonths(today, months), -1) };
}

function getSavedRange(): { start: Date; end: Date } | null {
  if (typeof window === "undefined") return null;
  const saved = localStorage.getItem(DATE_RANGE_KEY);
  if (!saved) return null;
  try {
    const { start, end } = JSON.parse(saved);
    return { start: new Date(start), end: new Date(end) };
  } catch {
    return null;
  }
}

function getSavedSelectedDay(): Date | null {
  if (typeof window === "undefined") return null;
  const saved = localStorage.getItem(SELECTED_DAY_KEY);
  if (!saved) return null;
  const d = new Date(saved);
  return isNaN(d.getTime()) ? null : d;
}

function saveSelectedDay(day: Date) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SELECTED_DAY_KEY, day.toISOString());
}

function saveDateRange(start: Date, end: Date) {
  localStorage.setItem(DATE_RANGE_KEY, JSON.stringify({
    start: start.toISOString(),
    end: end.toISOString(),
  }));
}

export const usePlanningStore = create<PlanningState>((set, get) => {
  const savedRange = getSavedRange();
  const defaultRange = getTodayRange();
  const { start, end } = savedRange ?? defaultRange;
  // Init cellWidth: saved slider value first, otherwise auto migration
  // from the legacy `humble-planning-zoom` step, otherwise the default value
  // CELL_DEFAULT (replaced by the admin default through initFromConfig).
  const savedCellWidth =
    getSavedCellWidth() ?? migrateLegacyZoom() ?? CELL_DEFAULT;
  const initialZoomLevel = zoomLevelFromCellWidth(savedCellWidth);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return {
    viewMode: getSavedViewMode(),
    startDate: start,
    endDate: end,
    cellWidth: savedCellWidth,
    // slotWidth (hours view) follows cellWidth through SLOT_TO_CELL_RATIO. rowHeight
    // stays fixed here — the actual bar height is driven by
    // PLANNING_LINE_HEIGHT (admin) in the renderer.
    slotWidth: Math.round(savedCellWidth * SLOT_TO_CELL_RATIO),
    zoomLevel: initialZoomLevel,
    rowHeight: 52,
    sortMode: getSavedSort(getSavedViewMode()),
    calendarMode: getSavedCalendarMode(),
    calendarDays: 5,
    calendarUserId: null,
    calendarShow24h: false,
    calendarPersonalView: "hours",
    columnMode: getSavedColumnMode(),
    selectedDay: getSavedSelectedDay() ?? today,
    showSummary: typeof window !== "undefined" ? localStorage.getItem(SUMMARY_KEY) === "true" : false,
    showUserCount: typeof window !== "undefined" ? localStorage.getItem(USER_COUNT_KEY) !== "false" : true,
    showFileIcon: typeof window !== "undefined" ? localStorage.getItem(FILE_ICON_KEY) !== "false" : true,
    showRowAvatar: typeof window !== "undefined" ? localStorage.getItem(ROW_AVATAR_KEY) !== "false" : true,
    selectedTaskId: null,
    selectedRowId: null,
    isDragging: false,
    dragTaskId: null,
    dragStartDate: null,
    clipboardTask: null,
    dragOverCellId: null,
    dragTaskHours: 1,
    resizePreview: null,
    ganttResizeActive: false,
    ganttResizePreview: null,
    pendingDrop: null,
    deletingTaskIds: new Set(),
    _configMonths: null,

    setViewMode: (mode) => {
      localStorage.setItem(VIEW_MODE_KEY, mode);
      set({ viewMode: mode, sortMode: getSavedSort(mode) });
    },

    setDateRange: (startDate, endDate) => {
      saveDateRange(startDate, endDate);
      set({ startDate, endDate });
    },

    setZoomLevel: (level) => {
      // Backward compat: convert the zoom step to the equivalent cellWidth in
      // the current admin range. The step is no longer stored separately.
      const width = cellWidthFromZoomLevel(level);
      get().setCellWidth(width);
    },

    setCellWidth: (width) => {
      const clamped = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.round(width)));
      localStorage.setItem(CELL_WIDTH_KEY, String(clamped));
      // STORAGE_KEY (legacy) kept in sync for any third-party consumers
      // that have not migrated, but it is no longer the source.
      localStorage.setItem(STORAGE_KEY, zoomLevelFromCellWidth(clamped));
      set({
        cellWidth: clamped,
        // In the hours view, one hour slot = 1.7 × day cell width
        // (ratio observed in the old zoom-step system, kept to
        // preserve a balanced rendering). The slider thus drives all 4 views.
        slotWidth: Math.round(clamped * SLOT_TO_CELL_RATIO),
        zoomLevel: zoomLevelFromCellWidth(clamped),
      });
    },

    getCellWidthRange: () => ({ min: CELL_MIN, max: CELL_MAX }),
    getMobileMaxCellWidth: () => CELL_MOBILE_MAX,

    /** Applies the mobile cap to cellWidth when the screen is below
     *  768 px, WITHOUT overwriting the user pref in localStorage: the user value
     *  is restored if the screen becomes wide again (resize or rotation).
     *  Call it when the schedule mounts and on the `resize` event. */
    applyMobileCap: () => {
      if (typeof window === "undefined") return;
      const userPref = getSavedCellWidth() ?? CELL_DEFAULT;
      const isMobile = window.innerWidth < 768;
      const target = isMobile ? Math.min(userPref, CELL_MOBILE_MAX) : userPref;
      const clamped = Math.max(CELL_MIN, Math.min(CELL_MAX, target));
      const current = get().cellWidth;
      if (current !== clamped) {
        set({
          cellWidth: clamped,
          slotWidth: Math.round(clamped * SLOT_TO_CELL_RATIO),
          zoomLevel: zoomLevelFromCellWidth(clamped),
        });
      }
    },

    setSelectedTask: (id) => set({ selectedTaskId: id }),
    setSelectedRow: (id) => set({ selectedRowId: id }),

    setDragState: (isDragging, taskId = null, startDate = null) =>
      set({ isDragging, dragTaskId: taskId, dragStartDate: startDate }),

    setClipboard: (taskId, mode) => set({ clipboardTask: { taskId, mode } }),
    clearClipboard: () => set({ clipboardTask: null }),
    setDragOverCell: (id) => set({ dragOverCellId: id }),
    setDragTaskHours: (hours: number) => set({ dragTaskHours: hours }),
    setResizePreview: (preview) => set({ resizePreview: preview }),
    setGanttResizeActive: (active) => set({ ganttResizeActive: active }),
    setGanttResizePreview: (preview) => set({ ganttResizePreview: preview }),
    setPendingDrop: (drop) => set({ pendingDrop: drop }),
    markTaskDeleting: (taskId) => set((s) => {
      const next = new Set(s.deletingTaskIds);
      next.add(taskId);
      return { deletingTaskIds: next };
    }),
    toggleSummary: () => set((s) => {
      const next = !s.showSummary;
      localStorage.setItem(SUMMARY_KEY, String(next));
      return { showSummary: next };
    }),
    toggleUserCount: () => set((s) => {
      const next = !s.showUserCount;
      localStorage.setItem(USER_COUNT_KEY, String(next));
      return { showUserCount: next };
    }),
    toggleFileIcon: () => set((s) => {
      const next = !s.showFileIcon;
      localStorage.setItem(FILE_ICON_KEY, String(next));
      return { showFileIcon: next };
    }),
    toggleRowAvatar: () => set((s) => {
      const next = !s.showRowAvatar;
      localStorage.setItem(ROW_AVATAR_KEY, String(next));
      return { showRowAvatar: next };
    }),

    navigateForward: () => {
      const { startDate, endDate } = get();
      const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
      const newStart = addDays(startDate, days);
      const newEnd = addDays(endDate, days);
      saveDateRange(newStart, newEnd);
      set({ startDate: newStart, endDate: newEnd });
    },

    navigateBackward: () => {
      const { startDate, endDate } = get();
      const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
      const newStart = addDays(startDate, -days);
      const newEnd = addDays(endDate, -days);
      saveDateRange(newStart, newEnd);
      set({ startDate: newStart, endDate: newEnd });
    },

    goToToday: () => {
      const months = get()._configMonths ?? 2;
      const { start, end } = getTodayRange(months);
      saveDateRange(start, end);
      set({ startDate: start, endDate: end });
    },

    setSortMode: (mode) => {
      const { viewMode } = get();
      localStorage.setItem(SORT_KEY_PREFIX + viewMode, mode);
      set({ sortMode: mode });
    },

    setColumnMode: (mode) => {
      localStorage.setItem(COLUMN_MODE_KEY, mode);
      set({ columnMode: mode });
    },

    setSelectedDay: (day) => {
      saveSelectedDay(day);
      set({ selectedDay: day });
    },

    navigateDayForward: () => {
      const { selectedDay } = get();
      const next = addDays(selectedDay, 1);
      saveSelectedDay(next);
      set({ selectedDay: next });
    },

    navigateDayBackward: () => {
      const { selectedDay } = get();
      const next = addDays(selectedDay, -1);
      saveSelectedDay(next);
      set({ selectedDay: next });
    },

    setCalendarMode: (mode) => {
      localStorage.setItem(CALENDAR_MODE_KEY, mode);
      set({ calendarMode: mode });
    },

    setCalendarDays: (days) => set({ calendarDays: days }),

    setCalendarUserId: (userId) => set({ calendarUserId: userId }),
    toggleCalendar24h: () => set((s) => ({ calendarShow24h: !s.calendarShow24h })),
    setCalendarPersonalView: (view) => set({ calendarPersonalView: view }),

    initFromConfig: (months, cellWidthConfig) => {
      // Store the config value for goToToday
      set({ _configMonths: months });
      // Only update range if no saved range in localStorage
      const savedRange = getSavedRange();
      if (!savedRange) {
        const { start, end } = getTodayRange(months);
        saveDateRange(start, end);
        set({ startDate: start, endDate: end });
      }
      // Apply admin-configured cell width bounds (min / max / default / mobile cap).
      // Sanity check: if the config is invalid (min > max), fall back
      // to the default bounds. The strict invariants are validated
      // on the server in PUT /api/config — this check is defensive.
      if (cellWidthConfig) {
        const min = cellWidthConfig.min ?? DEFAULT_CELL_MIN;
        const max = cellWidthConfig.max ?? DEFAULT_CELL_MAX;
        const def = cellWidthConfig.defaultW ?? DEFAULT_CELL_FALLBACK;
        const mob = cellWidthConfig.mobileMax ?? DEFAULT_CELL_MOBILE_MAX;
        if (min > 0 && max > 0 && min <= max && def >= min && def <= max && mob >= min) {
          CELL_MIN = min;
          CELL_MAX = max;
          CELL_DEFAULT = def;
          CELL_MOBILE_MAX = mob;
        }
      }
      // Re-clamp the current cellWidth into the new admin range. If
      // no user value is in localStorage, apply the admin default.
      const savedCustom = getSavedCellWidth();
      const target = savedCustom ?? CELL_DEFAULT;
      const clamped = Math.max(CELL_MIN, Math.min(CELL_MAX, target));
      if (savedCustom !== null && clamped !== savedCustom) {
        localStorage.setItem(CELL_WIDTH_KEY, String(clamped));
      }
      set({
        cellWidth: clamped,
        slotWidth: Math.round(clamped * SLOT_TO_CELL_RATIO),
        zoomLevel: zoomLevelFromCellWidth(clamped),
      });
    },

    applyUserDefaults: (defaults) => {
      // Apply user preferences from DB only if localStorage has no saved value
      if (defaults.viewMode && !localStorage.getItem(VIEW_MODE_KEY)) {
        const vm = defaults.viewMode as ViewMode;
        if (VALID_VIEW_MODES.includes(vm)) {
          set({ viewMode: vm, sortMode: getSavedSort(vm) });
        }
      }
      if (defaults.columnMode && !localStorage.getItem(COLUMN_MODE_KEY)) {
        const cm = defaults.columnMode as ColumnMode;
        if (VALID_COLUMN_MODES.includes(cm)) {
          set({ columnMode: cm });
        }
      }
    },
  };
});
