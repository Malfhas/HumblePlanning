/**
 * Shared types of the Canvas rendering engine.
 *
 * These types describe the primitives the renderer needs (viewport,
 * hit-test target, render context) and are deliberately kept
 * independent from React. They can be consumed from React hooks,
 * Web Workers, or Node unit tests.
 */

import type { Locale as DateFnsLocale } from "date-fns";
import type { TaskWithUsers, Status } from "@/types";
import type { GridRow as PlanningGridRow } from "@/lib/utils/sort-rows";
import type { AllocatedTask } from "@/lib/utils/slot-allocator";
import type { HolidayMap } from "@/components/planning/grid-header";
import type { ViewMode } from "@/stores/planning-store";
import type { ContractTypeKey } from "@/lib/constants/contract-types";

/** Current geometry of the planning grid. Recomputed when the scroll, the zoom
 *  or the window changes. All units are CSS pixels. */
export interface CanvasViewport {
  /** Width of the scrollable container. */
  width: number;
  /** Height of the scrollable container. */
  height: number;
  /** Width of the left sticky sidebar. */
  sidebarWidth: number;
  /** Height of the timeline header (3 rows month/week/day). */
  headerHeight: number;
  /** Width of a cell (1 day) — varies with the zoom. */
  cellWidth: number;
  /** Base height of a row (multiplied by maxSlot for multi-slot
   *  rows). Includes top/bottom padding. */
  baseRowHeight: number;
  /** Total number of days shown in the [startDate, endDate] window. */
  dayCount: number;
  /** Total number of visible rows (including group headers). */
  rowCount: number;
  /** Current horizontal scroll position (px from startDate). */
  scrollX: number;
  /** Current vertical scroll position (px from the top of the grid). */
  scrollY: number;
  /** Grid start date (origin for computing the bars). */
  gridStart: Date;
  /** Active Device Pixel Ratio (typically 1 or 2). */
  dpr: number;
}

/** Result of a pixel hit-test on the canvas. */
export type CanvasHitTarget =
  | {
      kind: "task";
      taskId: string;
      rowId: string;
      subzone: "body" | "resize-left" | "resize-right";
      /** Vertical edges of the bar in canvas-relative CSS pixels.
       *  Lets the tooltip anchor to the bar (parity with the legacy DOM). */
      barTop: number;
      barBottom: number;
    }
  | { kind: "cell"; rowId: string; dateStr: string }
  | { kind: "header"; dateStr: string }
  | {
      kind: "sidebar";
      rowId: string;
      /** Vertical edges of the row in canvas-relative CSS pixels. */
      rowTop: number;
      rowBottom: number;
    }
  | {
      /** Group banner (BU / team) — spans the full width of the
       *  table. Used by the tooltip that shows the full name when it
       *  is truncated in the sidebar. */
      kind: "group-header";
      rowId: string;
      rowTop: number;
      rowBottom: number;
    }
  | { kind: "none" };

/** Data source passed to the renderer. All references are
 *  stable (memoized upstream) — the renderer compares by reference
 *  identity to decide whether a static re-draw is needed. */
export interface CanvasRenderData {
  tasks: TaskWithUsers[];
  sortedRows: PlanningGridRow[];
  /** rowId → allocated tasks with their vertical slot and the row height. */
  slotData: Map<string, { tasks: AllocatedTask[]; maxSlot: number; height: number }>;
  /** dateIso → { label, color } for public holidays. */
  holidays: HolidayMap;
  /** statusId → status (to resolve colors and styles). */
  statusMap: Map<string, Status>;
  /** Show the user counter on multi-user bars. */
  showUserCount: boolean;
  /** Show the file icon on bars with attachments. */
  showFileIcon: boolean;
  /** Show the round avatar in the sidebar ("Profile picture" toggle
   *  of the Display menu). When false, only the row name is shown,
   *  left-aligned. */
  showRowAvatar?: boolean;
  /** View mode (users / projects / places / resources / vehicles) — sets
   *  the label shown on the bar (e.g. project name in the users view). */
  viewMode: ViewMode;
  /** Bar font family (configurable via /settings). */
  fontFamily?: string;
  /** Bar font size (configurable via /settings, default 11 px). */
  cellFontSize?: number;
  /** Bold bar text (configurable via /settings). */
  fontBold?: boolean;
  /** Task bar height in pixels (configurable via
   *  PLANNING_LINE_HEIGHT, default 24 px). */
  taskBarHeight?: number;
  /** Tasks refetch in progress (period change, socket invalidation).
   *  When true, the renderer paints skeleton bars in empty
   *  cells — "wave shimmer" visual feedback in the Notion / Linear style. */
  isFetching?: boolean;
  /** Canvas language (date-fns locale + labels precomputed on the React side). */
  i18n: CanvasI18n;
}

/**
 * Canvas language (class outside React): date-fns locale and labels
 * PRECOMPUTED on the React side (`useTranslations("planning.canvas")`), so
 * that no `t()` runs inside the render loop.
 */
export interface CanvasI18n {
  /** date-fns locale (`useDateFormat().dateLocale`): month names and day initials. */
  dateLocale: DateFnsLocale;
  labels: {
    /** Top-left corner of the week row (« Sem. » / « Wk »). */
    weekAbbr: string;
    /** Week number prefix (« S12 » / « W12 »). */
    weekPrefix: string;
    /** Fallback title of a task without a title. */
    untitled: string;
  };
  /** Contract type labels (`users.contractTypes.*`): « [Intérimaire] » suffix of names in the users view. */
  contractLabels: Partial<Record<ContractTypeKey, string>>;
}

/** State of an active drag (read during the interactive rAF loop without
 *  a React re-render). Mutated directly via `dragStateRef.current`. */
export interface CanvasDragState {
  active: boolean;
  taskId: string | null;
  /** Drag mode: full move or resize of one edge. */
  mode: "move" | "resize-left" | "resize-right" | null;
  /** Pointer x coordinate at pointerdown (CSS pixels, viewport). */
  originX: number;
  /** Pointer y coordinate at pointerdown. */
  originY: number;
  /** Day offset derived from the x delta snapped to cellWidth. */
  deltaDays: number;
  /** Current target rowId (if different from the source row = row change). */
  targetRowId: string | null;
  /** Current pointer position (CSS pixels, viewport) — used to
   *  position the DragOverlay and compute the cell under the cursor. */
  pointerX: number;
  pointerY: number;
  /** Index in `daysIso` of the day clicked at pointerdown (cell under the
   *  mouse when the drag starts). Used to anchor the drag preview to the
   *  cursor when the source task is truncated on the left: the start of
   *  the bar then follows the mouse (consistent UX when the task origin
   *  is outside the period). */
  clickedDayIdx: number;
}

/** Initial drag state — used to reset dragStateRef.current. */
export const INITIAL_DRAG_STATE: CanvasDragState = {
  active: false,
  taskId: null,
  mode: null,
  originX: 0,
  originY: 0,
  deltaDays: 0,
  targetRowId: null,
  pointerX: 0,
  pointerY: 0,
  clickedDayIdx: 0,
};

/** Ids of the layers to redraw. The renderer marks layers
 *  dirty and coalesces redraws into the next rAF tick. */
export interface LayerDirtyFlags {
  static: boolean;
  interactive: boolean;
}
