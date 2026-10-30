/**
 * CanvasRenderer — rendering engine of the planning grid.
 *
 * Architecture:
 *  - Vanilla TS, no React dependency (testable in Node)
 *  - Dual canvas: `static` (cells + bars) + `interactive` (ghost,
 *    drag preview, today marker)
 *  - Static: redraw when data/viewport change (triggered via
 *    `markStaticDirty` + coalescing into the next rAF tick)
 *  - Interactive: redraw every frame of the rAF loop (reads `dragStateRef`
 *    + `hoveredTaskIdRef` directly, no React state)
 *  - Hit-testing: O(1) via Math.floor + bucket map
 *
 * Typical lifecycle:
 *   const r = new CanvasRenderer({ staticCanvas, interactiveCanvas });
 *   r.setViewport(viewport);
 *   r.setData(data);
 *   r.start();      // starts the rAF loop
 *   // ...
 *   r.stop();       // stops the rAF loop
 *   r.dispose();    // full cleanup
 */

import { differenceInCalendarDays, eachDayOfInterval, format, isToday, isWeekend } from "date-fns";
import { fr } from "date-fns/locale";
import { getISOWeek } from "date-fns";

import type { TaskWithUsers } from "@/types";
import type { AllocatedTask } from "@/lib/utils/slot-allocator";
import { getTaskLabel } from "@/lib/utils/task-label";
import { getContractSuffix } from "@/lib/constants/contract-types";
import { getTaskTimeSlot, type TaskTimeSlot } from "@/lib/utils/time-slots";

import {
  CANVAS_GEOMETRY,
  CANVAS_PALETTE,
  getCssColor,
  getContrastColor,
  getTaskBarLabelColor,
  getTaskBarIconColor,
  brightenColor,
  vibrantizeColor,
} from "./theme";
import { setupHiDPI, type HiDPISetup } from "./dpr";
import { fitText } from "./text";
import {
  CANVAS_ICONS,
  drawCanvasIcon,
  ICON_SIZE_DEFAULT,
  ICON_SIZE_MEDIUM,
  getIconLayoutWidth,
} from "./icons";
import {
  buildBucketMap,
  buildRowYMap,
  getTotalContentHeight,
  hitTestCanvas,
  type BucketMap,
} from "./hit-test";
import type {
  CanvasViewport,
  CanvasRenderData,
  CanvasDragState,
  CanvasHitTarget,
  CanvasI18n,
} from "./types";
import {
  ANIM_DURATIONS,
  computeAnimEffect,
  easeInQuad,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  easeOutQuart,
  isAnimDone,
  NEUTRAL_EFFECT,
  type AnimEffect,
  type TaskAnim,
} from "./animations";
import { drawSkeletonCell } from "./skeleton";
import { getCachedAvatar, buildAvatarUrl } from "./avatar-cache";

/** Border color of the canvas grid. Fixed RGB (not OKLCH — the shadcn
 *  `--border` in dark mode is `oklch(1 0 0 / 10%)`, which is too
 *  faint for a 1 px line, and the 2D canvas does not support oklch
 *  alpha in every context). Chosen to contrast with both
 *  `--background` and `--muted` (weekend cells), with a
 *  moderate contrast so the grid does not look heavy. */
function getGridBorderColor(): string {
  if (typeof document === "undefined") return "rgb(214, 218, 226)";
  return document.documentElement.classList.contains("dark")
    ? "rgb(72, 80, 92)"
    : "rgb(214, 218, 226)";
}

/** Extracts the canonical ID of a task for lookup in `taskIndex`.
 *
 *  Handled cases:
 *  - Pseudo-tasks `va:xxx` / `ra:xxx` (vehicle/resource assignments):
 *    the full ID is the canonical key → returned as is.
 *  - Users-view compound `${taskId}:${userId}`: returns `taskId`.
 *  - Otherwise: returned as is.
 *
 *  Historical bug: before this helper, `id.split(":")[0]` broke
 *  pseudo-tasks by returning just `"va"` / `"ra"`, which made them
 *  invisible (taskIndex.get missed) while still detectable on click
 *  (the hit-test used the full ID via `at.id`). */
export function extractRealTaskId(id: string): string {
  if (id.startsWith("va:") || id.startsWith("ra:")) return id;
  if (id.includes(":")) return id.split(":")[0];
  return id;
}

/** Computes the initials of a name (2 chars max). "Jean Dupont" → "JD",
 *  "Cédric" → "CÉ", "" → "?". */
/**
 * Determines the icon to draw in front of a group header banner based on
 * the ID convention used by `sort-rows.ts`:
 *  - `header-bu-XXX-team-YYY` → team under a BU   → UsersRound
 *  - `header-bu-XXX`          → Business Unit     → Building2
 *  - `header-team-XXX`        → standalone team   → UsersRound
 *  - `header-group-XXX` → Layers (Projects display view)
 *  - others → no icon (color alone is enough)
 *
 * Consistent with the sidebar menu icons (Building2 + UsersRound + Layers),
 * so the user finds the same visual cues nav ↔ schedule.
 */
export function headerIconFor(
  id: string
): "building2" | "usersRound" | "layers" | null {
  // The "-team-" and "-grp-" checks MUST come before the generic
  // `header-bu-` check: the `custom-bu-group` sortMode generates
  // `header-bu-${bu}-grp-${grp}`, which would otherwise match the BU fallback
  // → Building2 icon wrongly shown on project group banners.
  if (id.startsWith("header-bu-") && id.includes("-team-")) return "usersRound";
  if (id.startsWith("header-bu-") && id.includes("-grp-")) return "layers";
  if (id.startsWith("header-bu-")) return "building2";
  if (id.startsWith("header-team-")) return "usersRound";
  if (id.startsWith("header-group-")) return "layers";
  return null;
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Initial language, before the first `setData` (which carries `data.i18n`):
 *  source-language locale, empty labels (never any hard-coded text in
 *  the rendering engine). */
const DEFAULT_CANVAS_I18N: CanvasI18n = {
  dateLocale: fr,
  labels: { weekAbbr: "", weekPrefix: "", untitled: "" },
  contractLabels: {},
};

/** Header labels of a day, computed once per day and per language. */
interface DayHeaderLabels {
  /** « Octobre 2026 » / « October 2026 » (first letter capitalized). */
  month: string;
  /** « S44 » / « W44 ». */
  week: string;
  /** Capitalized day initial (« J » / « T »). */
  letter: string;
}

/** Minimal type of the constructor arguments. */
interface CanvasRendererInit {
  staticCanvas: HTMLCanvasElement;
  interactiveCanvas: HTMLCanvasElement;
  /** Mutable ref read on each interactive frame. The renderer never modifies it. */
  dragStateRef: { current: CanvasDragState };
  /** Mutable ref of the hovered taskId (used for the visual hover). */
  hoveredTaskIdRef: { current: string | null };
  /** Mutable ref of the hovered cell (cell hover overlay). */
  hoveredCellRef?: { current: { rowId: string; dateStr: string } | null };
}

export class CanvasRenderer {
  // ──────────────────────────────────────────────────────────────────
  // DOM refs and mutable state
  // ──────────────────────────────────────────────────────────────────
  private staticCanvas: HTMLCanvasElement;
  private interactiveCanvas: HTMLCanvasElement;
  private dragStateRef: { current: CanvasDragState };
  private hoveredTaskIdRef: { current: string | null };
  /** Currently hovered cell (bg-primary/10 hover overlay). Mutated
   *  by the component via the ref → the renderer reads it every frame. */
  private hoveredCellRef: { current: { rowId: string; dateStr: string } | null } = { current: null };

  private viewport: CanvasViewport | null = null;
  private data: CanvasRenderData | null = null;

  /** Current language (date-fns locale + precomputed labels). */
  private i18n: CanvasI18n = DEFAULT_CANVAS_I18N;
  /** Cache of header labels per ISO day, cleared when the language
   *  changes. Avoids one date-fns `format()` per visible day on every
   *  static redraw (scroll). */
  private dayHeaderCache: Map<string, DayHeaderLabels> = new Map();

  /** List of ISO days from startDate (cache for hit-test and draw). */
  private daysIso: string[] = [];
  /** Bucket map rowId → tasks (for fast hit-testing). */
  private buckets: BucketMap = new Map();
  /** Map rowId → { y, height } (to position the rows). */
  private rowIdToY: Map<string, { y: number; height: number }> = new Map();
  /** Total height of the scrollable content (all rows). */
  private totalContentHeight = 0;
  /** Map taskId → AllocatedTask (fast lookup for the drag preview). */
  private taskIdToAllocated: Map<string, { rowId: string; allocated: AllocatedTask }> = new Map();
  /** Map real task ID → canResize. In the users view, `taskIdToAllocated` is
   *  keyed by `${realId}:${userId}` (compound), while `drawTaskBar`
   *  receives the real task (real ID). This map allows a direct lookup
   *  by real ID, shared across all occurrences of the same task. */
  private realIdToCanResize: Map<string, boolean> = new Map();

  /** Deferred redraw flags. */
  private staticDirty = true;
  private interactiveDirty = true;

  /** Effective task bar height (admin config > default). */
  private getBarHeight(): number {
    return this.data?.taskBarHeight ?? CANVAS_GEOMETRY.taskBarHeight;
  }

  /** Active animations per taskId (move, resize, appear, delete).
   *  The rAF loop ticks every frame and applies the visual effects via
   *  `computeAnimEffect()`. A finished animation is removed
   *  automatically, which returns the bar to its cached position. */
  private taskAnimations: Map<string, TaskAnim> = new Map();

  /** Task dates frozen at drag start. Without this, the preview
   *  re-reads `task.startDate/endDate` from the cache every frame; when
   *  `mutate.onMutate` updates the cache (in a microtask, before the
   *  pointer hook's 150 ms hold), the preview applies `deltaDays`
   *  to the NEW dates → `OLD + 2*deltaDays` days shown
   *  briefly (= "+1 extra cell" as perceived by the user). */
  private dragOriginStartDate: string | null = null;
  private dragOriginEndDate: string | null = null;
  private prevDragActive = false;

  /** Ghost preview shown while the `DropActionMenu` is open
   *  (between pointerup and the Move/Copy choice). A semi-trans-
   *  parent bar is drawn at the target position to show what
   *  will happen on confirm. The target row is also expanded
   *  dynamically to fit the ghost (see drag expansion). */
  private pendingDropPreview: {
    taskId: string;
    targetRowId: string;
    newStartDate: string;
    newEndDate: string;
  } | null = null;

  /** rAF loop. */
  private rafId = 0;
  private running = false;

  /** `Map<taskId, TaskWithUsers>` index for fast resolution. */
  private taskIndex: Map<string, TaskWithUsers> = new Map();

  constructor(init: CanvasRendererInit) {
    this.staticCanvas = init.staticCanvas;
    this.interactiveCanvas = init.interactiveCanvas;
    this.dragStateRef = init.dragStateRef;
    this.hoveredTaskIdRef = init.hoveredTaskIdRef;
    if (init.hoveredCellRef) this.hoveredCellRef = init.hoveredCellRef;
  }

  // ──────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────

  /** Updates the viewport (canvas size, scroll, geometry). */
  setViewport(viewport: CanvasViewport): void {
    this.viewport = viewport;
    this.refreshDays();
    this.markStaticDirty();
  }

  /** Updates the data. Call when tasks/sortedRows/slotData
   *  change (API mutation). Also detects new tasks and
   *  triggers the "appear" anim immediately (sync, before the next
   *  draw — otherwise there was 1 "flash" frame at alpha=1 between
   *  setData and the anim triggered by a useEffect in the component). */
  setData(data: CanvasRenderData): void {
    // Snapshot of the previous IDs BEFORE replacing taskIndex
    const previousIds = this.data ? new Set(this.taskIndex.keys()) : null;

    this.setI18n(data.i18n);
    this.data = data;
    // Rebuild the task index by ID
    this.taskIndex = new Map(data.tasks.map((t) => [t.id, t]));

    // Auto-trigger "appear" on new IDs (skipped for an optimistic → real
    // replacement, to avoid a double visual pop).
    if (previousIds) {
      // Detect optimistic IDs: `__optimistic_` (tasks) or
      // `va:__optimistic_` / `ra:__optimistic_` (assignments wrapped
      // as pseudo-tasks). Without the va:/ra: prefix, the optimistic entry of a
      // booking triggered 2 "appear" anims (one for the optimistic,
      // one for the server replacement) → visible flicker.
      const isOptId = (id: string) =>
        id.startsWith("__optimistic_") ||
        id.startsWith("va:__optimistic_") ||
        id.startsWith("ra:__optimistic_");
      let optimisticDisappeared = false;
      for (const id of previousIds) {
        if (isOptId(id) && !this.taskIndex.has(id)) {
          optimisticDisappeared = true;
          break;
        }
      }
      for (const t of data.tasks) {
        if (previousIds.has(t.id)) continue;
        if (this.taskAnimations.has(t.id)) continue; // anim already active
        if (isOptId(t.id)) continue; // the optimistic entry itself does not animate
        if (optimisticDisappeared) continue; // server replacement → no 2nd anim
        this.startAppearAnimation(t.id);
      }
    }
    // Rebuild the allocation map by taskId + the real→canResize map.
    this.taskIdToAllocated = new Map();
    this.realIdToCanResize = new Map();
    for (const [rowId, slot] of data.slotData) {
      for (const at of slot.tasks) {
        this.taskIdToAllocated.set(at.id, { rowId, allocated: at });
        const realId = extractRealTaskId(at.id);
        if (at.canResize !== undefined) {
          this.realIdToCanResize.set(realId, at.canResize);
        }
      }
    }
    // Rebuild the hit-test structures
    this.buckets = buildBucketMap(data.slotData);
    this.rowIdToY = buildRowYMap(data.sortedRows, data.slotData);
    this.totalContentHeight = getTotalContentHeight(this.rowIdToY, data.sortedRows);
    this.markStaticDirty();
  }

  /** Changes the canvas language. Same object (memoized on the React side) → no-op;
   *  otherwise clears the header label cache and redraws. The `fitText`
   *  cache is keyed by the text: nothing to invalidate there. */
  setI18n(i18n: CanvasI18n): void {
    if (i18n === this.i18n) return;
    this.i18n = i18n;
    this.dayHeaderCache.clear();
    this.markStaticDirty();
  }

  /** Header labels of day `dateStr` (month, week, initial), cached. */
  private getDayHeaderLabels(dateStr: string): DayHeaderLabels {
    let labels = this.dayHeaderCache.get(dateStr);
    if (labels) return labels;
    // Memory bound (navigation across several years): start over from scratch.
    if (this.dayHeaderCache.size > 5000) this.dayHeaderCache.clear();
    const date = new Date(dateStr);
    const locale = this.i18n.dateLocale;
    const month = format(date, "MMMM yyyy", { locale });
    labels = {
      month: month.charAt(0).toUpperCase() + month.slice(1),
      week: this.i18n.labels.weekPrefix + getISOWeek(date),
      letter: format(date, "EEEEE", { locale }).toUpperCase(),
    };
    this.dayHeaderCache.set(dateStr, labels);
    return labels;
  }

  /** Marks the static layer for redraw (coalesced into the next tick). */
  markStaticDirty(): void {
    this.staticDirty = true;
    this.interactiveDirty = true;
  }

  // ──────────────────────────────────────────────────────────────────
  // Animation API (move / resize / appear / delete)
  //
  // Why: every user action (drag drop, resize, creation,
  // deletion) must have smooth visual feedback without depending on the
  // backend response cycle. Mutations are already optimistic
  // on the React Query side, but the canvas snaps to the grid without a transition →
  // stutter. These methods set up a local animation that interpolates
  // the pixels for N ms, independently of the cache.
  // ──────────────────────────────────────────────────────────────────

  /** "move" anim: the bar comes from `fromX,fromY` (where it was before
   *  the drop) to its current position in the cache (read
   *  every frame from slotData). We store the offset to cancel out. */
  startMoveAnimation(taskId: string, fromX: number, fromY: number, toX: number, toY: number): void {
    this.taskAnimations.set(taskId, {
      kind: "move",
      startTime: performance.now(),
      duration: ANIM_DURATIONS.move,
      easing: easeOutExpo,
      offsetX: fromX - toX,
      offsetY: fromY - toY,
    });
    this.markStaticDirty();
  }

  /** "resize" anim: the bar goes from `fromWidth` to `toWidth` (and
   *  possibly from `fromX` to `toX` when edge=left). */
  startResizeAnimation(taskId: string, fromX: number, fromWidth: number, toX: number, toWidth: number): void {
    // easeOutQuart: a bit more pronounced than cubic for an
    // Apple-like "stretch" feel on the width transition.
    this.taskAnimations.set(taskId, {
      kind: "resize",
      startTime: performance.now(),
      duration: ANIM_DURATIONS.resize,
      easing: easeOutQuart,
      offsetX: fromX - toX,
      offsetWidth: fromWidth - toWidth,
    });
    this.markStaticDirty();
  }

  /** "appear" anim: opacity 0→1, scaleX 0.92→1, easeOutBack for a
   *  slight pop. Trigger as soon as a new task appears in
   *  the cache (creation, copy, paste). */
  startAppearAnimation(taskId: string): void {
    this.taskAnimations.set(taskId, {
      kind: "appear",
      startTime: performance.now(),
      duration: ANIM_DURATIONS.appear,
      easing: easeOutBack,
    });
    this.markStaticDirty();
  }

  /** "delete" anim: opacity 1→0, scaleX 1→0.92. The component must
   *  delay the mutation by `ANIM_DURATIONS.delete` ms to let
   *  the animation play before the task leaves the cache. */
  startDeleteAnimation(taskId: string): void {
    this.taskAnimations.set(taskId, {
      kind: "delete",
      startTime: performance.now(),
      duration: ANIM_DURATIONS.delete,
      easing: easeInQuad,
    });
    this.markStaticDirty();
  }

  /** Cancels all running animations on a task (e.g. rollback
   *  after a failed mutation). */
  cancelTaskAnimation(taskId: string): void {
    if (this.taskAnimations.delete(taskId)) {
      this.markStaticDirty();
    }
  }

  /** Tick: removes finished animations. Called on every rAF. */
  private tickAnimations(now: number): boolean {
    if (this.taskAnimations.size === 0) return false;
    let didChange = false;
    for (const [taskId, anim] of this.taskAnimations) {
      if (isAnimDone(anim, now)) {
        this.taskAnimations.delete(taskId);
        didChange = true;
      }
    }
    return didChange;
  }

  /** Current visual effect for a task (applied at draw). Returns
   *  `NEUTRAL_EFFECT` when no animation is active. */
  private getAnimEffect(taskId: string, now: number): AnimEffect {
    const anim = this.taskAnimations.get(taskId);
    if (!anim) return NEUTRAL_EFFECT;
    return computeAnimEffect(anim, now);
  }

  /** Prospective pixel position of a task in a target row with
   *  new dates (used to compute the toRect of a move
   *  BEFORE the mutation propagates to the cache). The slot is computed
   *  like a ghost (first free slot, skipping holidays). */
  getProspectiveTaskRect(
    targetRowId: string,
    excludeTaskId: string,
    newStartDate: string,
    newEndDate: string
  ): { x: number; y: number; width: number; height: number } | null {
    const v = this.viewport;
    if (!v) return null;
    const rowInfo = this.rowIdToY.get(targetRowId);
    if (!rowInfo) return null;
    const startIdx = this.daysIso.indexOf(newStartDate);
    if (startIdx < 0) return null;
    const endIdx = this.daysIso.indexOf(newEndDate);
    const finalEndIdx = endIdx >= 0 ? endIdx : startIdx;
    const taskLeftPx = startIdx * v.cellWidth;
    const taskWidthPx = (finalEndIdx - startIdx + 1) * v.cellWidth;
    const x = v.sidebarWidth + taskLeftPx - v.scrollX + 4;
    const width = Math.max(taskWidthPx - 8, 12);
    const slot = this.computeGhostSlotInRow(targetRowId, excludeTaskId, newStartDate, newEndDate);
    const y =
      v.headerHeight +
      rowInfo.y -
      v.scrollY +
      slot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) +
      CANVAS_GEOMETRY.rowPadding;
    return { x, y, width, height: this.getBarHeight() };
  }

  /** Current pixel position of a bar (viewport coords, in CSS px).
   *  Used by the component to capture fromX/fromY before a drop
   *  or a resize, then start the appropriate animation.
   *
   *  Accepts both a real ID and a compound `taskId:userId` (users
   *  view). If several allocations match the real ID, the
   *  first one found is returned. */
  getTaskRect(taskId: string): { x: number; y: number; width: number; height: number } | null {
    const v = this.viewport;
    if (!v) return null;
    let allocInfo = this.taskIdToAllocated.get(taskId);
    if (!allocInfo) {
      // In the users view, the ID is a compound `${realId}:${userId}`.
      // If we are given a real ID, look for any
      // allocation whose key starts with `${taskId}:`.
      const prefix = `${taskId}:`;
      for (const [id, info] of this.taskIdToAllocated) {
        if (id.startsWith(prefix)) {
          allocInfo = info;
          break;
        }
      }
    }
    if (!allocInfo) return null;
    const rowInfo = this.getEffectiveRowInfo(allocInfo.rowId);
    if (!rowInfo) return null;
    const at = allocInfo.allocated;
    const taskStartIdx = this.daysIso.indexOf(at.startDate);
    const taskEndIdx = this.daysIso.indexOf(at.endDate ?? at.startDate);
    if (taskStartIdx < 0) return null;
    const startIdx = taskStartIdx;
    const endIdx = taskEndIdx >= 0 ? taskEndIdx : startIdx;
    const taskLeftPx = startIdx * v.cellWidth;
    const taskWidthPx = (endIdx - startIdx + 1) * v.cellWidth;
    const x = v.sidebarWidth + taskLeftPx - v.scrollX + 4;
    const width = Math.max(taskWidthPx - 8, 12);
    const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;
    const y = rowYTop + at.slot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) + CANVAS_GEOMETRY.rowPadding;
    return { x, y, width, height: this.getBarHeight() };
  }

  /** Starts the rAF loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      // Tick anims: remove finished ones, force a redraw while any
      // remain (otherwise the static layer "snaps" to the cached position).
      const now = performance.now();
      const animsActive = this.taskAnimations.size > 0;
      this.tickAnimations(now);
      if (animsActive) this.staticDirty = true;
      // During a drag move, force static dirty so that the
      // target row is redrawn at its expanded height (and the rows
      // below are shifted). The cost is minimal — the user is holding the
      // button, frame by frame.
      const drag = this.dragStateRef.current;
      if (drag.active && drag.mode === "move") {
        this.staticDirty = true;
      }
      // Capture the task dates when the drag goes false→true,
      // clear them when it goes back to false. The preview uses these dates
      // so it is not disturbed by the cache's optimistic updates.
      if (drag.active && !this.prevDragActive && drag.taskId) {
        const realId = extractRealTaskId(drag.taskId);
        const task = this.taskIndex.get(realId);
        if (task) {
          this.dragOriginStartDate = task.startDate;
          this.dragOriginEndDate = task.endDate ?? task.startDate;
        }
      } else if (!drag.active && this.prevDragActive) {
        this.dragOriginStartDate = null;
        this.dragOriginEndDate = null;
      }
      this.prevDragActive = drag.active;
      // During a tasks refetch, force a continuous redraw so that
      // the shimmer wave animates — otherwise the skeleton stays frozen until
      // the next markStaticDirty.
      if (this.data?.isFetching) this.staticDirty = true;
      if (this.staticDirty) {
        this.drawStatic();
        this.staticDirty = false;
      }
      this.drawInteractive();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Stops the rAF loop. */
  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Full cleanup (call when the component unmounts). */
  dispose(): void {
    this.stop();
    this.data = null;
    this.viewport = null;
    this.taskIndex.clear();
    this.taskIdToAllocated.clear();
    this.realIdToCanResize.clear();
    this.buckets.clear();
    this.rowIdToY.clear();
  }

  /** Pixel hit-test on the canvas (viewport CSS pixel coords). */
  hitTest(x: number, y: number): CanvasHitTarget {
    if (!this.viewport) return { kind: "none" };
    if (!this.data) return { kind: "none" };
    return hitTestCanvas(
      x,
      y,
      this.viewport,
      this.buckets,
      this.rowIdToY,
      this.daysIso,
      this.data.sortedRows
    );
  }

  /** Total height of the scrollable content (for scroll bounds).
   *  Includes any drag expansion. */
  getTotalContentHeight(): number {
    return this.totalContentHeight + this.getDragTargetExtraHeight();
  }

  // ──────────────────────────────────────────────────────────────────
  // Dynamic expansion of the target row during a drag move
  //
  // Why: so the user sees the translucent ghost preview
  // in the target cell (without it overflowing onto the row
  // below), the target row is dynamically enlarged while the drag
  // is active and the ghostSlot exceeds maxSlot. The following rows
  // are shifted by the same amount.
  // ──────────────────────────────────────────────────────────────────

  /** Computes the first free slot in `targetRowId` for the given
   *  dates, excluding the task itself and all its occurrences
   *  (users view → compound IDs `taskId:userId`). Skips slot 0 if a
   *  holiday overlaps. */
  private computeGhostSlotInRow(
    targetRowId: string,
    excludeTaskId: string,
    newStartDate: string,
    newEndDate: string
  ): number {
    const targetBucket = this.buckets.get(targetRowId) ?? [];
    const realExcludeId = extractRealTaskId(excludeTaskId);
    const excludePrefix = `${realExcludeId}:`;
    const overlaps = (t: { startDate: string; endDate?: string | null }) =>
      newStartDate <= (t.endDate ?? t.startDate) && newEndDate >= t.startDate;
    const hasHolidayConflict = targetBucket.some(
      (t) => t.id.startsWith("holiday:") && overlaps(t)
    );
    let slot = hasHolidayConflict ? 1 : 0;
    const MAX_SLOT = 50;
    while (slot < MAX_SLOT) {
      const conflict = targetBucket.some(
        (t) =>
          t.id !== excludeTaskId &&
          !t.id.startsWith(excludePrefix) &&
          !t.id.startsWith("holiday:") &&
          t.slot === slot &&
          overlaps(t)
      );
      if (!conflict) break;
      slot++;
    }
    return slot;
  }

  /** Ghost slot for the current drag move. null if there is no drag move. */
  private computeDragGhostSlot(): number | null {
    const drag = this.dragStateRef.current;
    if (!drag.active || drag.mode !== "move" || !drag.taskId || !drag.targetRowId) return null;
    const realTaskId = extractRealTaskId(drag.taskId);
    const task = this.taskIndex.get(realTaskId);
    if (!task) return null;
    const taskStartIdx = this.daysIso.indexOf(task.startDate);
    if (taskStartIdx < 0) return null;
    const taskEndIdx = this.daysIso.indexOf(task.endDate ?? task.startDate);
    const spanDays = (taskEndIdx >= 0 ? taskEndIdx : taskStartIdx) - taskStartIdx + 1;
    const newStartIdx = taskStartIdx + drag.deltaDays;
    const newEndIdx = Math.min(
      Math.max(0, newStartIdx + spanDays - 1),
      this.daysIso.length - 1
    );
    const newStartDate = this.daysIso[newStartIdx] ?? task.startDate;
    const newEndDate = this.daysIso[newEndIdx] ?? newStartDate;
    return this.computeGhostSlotInRow(drag.targetRowId, drag.taskId, newStartDate, newEndDate);
  }

  /** "Active" target row for the dynamic expansion: drag move OR
   *  pending drop (DropActionMenu open). */
  private getActiveTargetRowId(): string | null {
    const drag = this.dragStateRef.current;
    if (drag.active && drag.mode === "move" && drag.targetRowId) return drag.targetRowId;
    if (this.pendingDropPreview) return this.pendingDropPreview.targetRowId;
    return null;
  }

  /** Sets or clears the "pending drop" ghost shown while
   *  the Move/Copy menu is open. */
  setPendingDropPreview(info: {
    taskId: string;
    targetRowId: string;
    newStartDate: string;
    newEndDate: string;
  } | null): void {
    this.pendingDropPreview = info;
    this.markStaticDirty();
  }

  /** Extra height required on the target row to fit
   *  the ghost (drag move OR pending drop). 0 if nothing to expand. */
  private getDragTargetExtraHeight(): number {
    const slotH = this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap;
    // Active drag move
    const drag = this.dragStateRef.current;
    if (drag.active && drag.mode === "move" && drag.targetRowId) {
      const targetInfo = this.rowIdToY.get(drag.targetRowId);
      const ghostSlot = this.computeDragGhostSlot();
      if (targetInfo && ghostSlot !== null) {
        const required = (ghostSlot + 1) * slotH + 12;
        return Math.max(0, required - targetInfo.height);
      }
    }
    // Pending drop (DropActionMenu)
    if (this.pendingDropPreview) {
      const { targetRowId, taskId, newStartDate, newEndDate } = this.pendingDropPreview;
      const targetInfo = this.rowIdToY.get(targetRowId);
      if (targetInfo) {
        const ghostSlot = this.computeGhostSlotInRow(targetRowId, taskId, newStartDate, newEndDate);
        const required = (ghostSlot + 1) * slotH + 12;
        return Math.max(0, required - targetInfo.height);
      }
    }
    return 0;
  }

  /** Returns the effective y/height with the drag/pending-drop expansion:
   *  - target row: increased height
   *  - rows below: shifted y
   *  - others: unchanged */
  private getEffectiveRowInfo(rowId: string): { y: number; height: number } | null {
    const info = this.rowIdToY.get(rowId);
    if (!info) return null;
    const targetRowId = this.getActiveTargetRowId();
    if (!targetRowId) return info;
    const targetInfo = this.rowIdToY.get(targetRowId);
    if (!targetInfo) return info;
    const extra = this.getDragTargetExtraHeight();
    if (extra === 0) return info;
    if (rowId === targetRowId) {
      return { y: info.y, height: info.height + extra };
    }
    if (info.y > targetInfo.y) {
      return { y: info.y + extra, height: info.height };
    }
    return info;
  }

  /** IDs of the currently visible tasks (for the a11y DOM mirror). */
  getVisibleTaskIds(): string[] {
    if (!this.viewport || !this.data) return [];
    const v = this.viewport;
    const visibleLeft = v.scrollX;
    const visibleRight = v.scrollX + (v.width - v.sidebarWidth);
    const firstDayIdx = Math.max(0, Math.floor(visibleLeft / v.cellWidth));
    const lastDayIdx = Math.min(v.dayCount - 1, Math.ceil(visibleRight / v.cellWidth));
    const ids: string[] = [];
    for (const [rowId, allocs] of this.buckets) {
      const rowInfo = this.getEffectiveRowInfo(rowId);
      if (!rowInfo) continue;
      const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;
      const rowYBottom = rowYTop + rowInfo.height;
      if (rowYBottom < v.headerHeight || rowYTop > v.height) continue;
      for (const at of allocs) {
        if (at.id.startsWith("holiday:")) continue;
        const taskStartIdx = this.daysIso.indexOf(at.startDate);
        const taskEndIdx = this.daysIso.indexOf(at.endDate ?? at.startDate);
        if (taskEndIdx < firstDayIdx || taskStartIdx > lastDayIdx) continue;
        ids.push(at.id);
      }
    }
    return ids;
  }

  // ──────────────────────────────────────────────────────────────────
  // Static rendering (grid + bars)
  // ──────────────────────────────────────────────────────────────────

  private drawStatic(): void {
    const v = this.viewport;
    const data = this.data;
    if (!v || !data) return;

    const setup = setupHiDPI(this.staticCanvas, v.width, v.height, false);
    if (!setup) return;
    const { ctx, width: w, height: h } = setup;
    // Disable smoothing — a 1 CSS px `fillRect` must render 2 crisp buffer
    // pixels without interpolation. Without this flag, some browsers
    // apply anti-aliasing that blurs thin lines depending on the
    // position (visible when scrolling horizontally).
    ctx.imageSmoothingEnabled = false;

    // Global background
    ctx.fillStyle = getCssColor("--background", "#ffffff");
    ctx.fillRect(0, 0, w, h);

    this.drawGridBackground(ctx, w, h);
    // Cell hover overlay painted BEFORE the bars (in the background,
    // parity with the legacy `hover:bg-primary/10` on the DOM cell only).
    this.drawHoverCellOverlay(ctx, w, h);
    // Skeleton bars (wave shimmer) during a tasks refetch. Painted before
    // the real bars so they go on top as soon as the cache
    // is updated. Skipped when not fetching or when the row already has
    // tasks in the cache (skeleton only on empty cells).
    if (this.data?.isFetching) {
      this.drawSkeletonBars(ctx, w, h);
    }
    this.drawTasks(ctx, w, h);
    // Pending drop ghost (DropActionMenu open) — semi-transparent
    // at the target position. Drawn after the bars to be visible
    // on top, but before header/sidebar (which are sticky).
    this.drawPendingDropGhost(ctx);
    this.drawSidebar(ctx, w, h);
    // Sticky group banner: reproduces the last header scrolled past
    // the fold, pinned at `y = headerHeight`. Drawn BEFORE `drawHeader`
    // so the timeline (days / weeks / months) covers its
    // top part during the push effect — otherwise the banner "goes over
    // the days" instead of sliding underneath.
    this.drawStickyGroupHeader(ctx, w);
    this.drawHeader(ctx, w, h);
  }

  /** Translucent highlight on the hovered cell. Painted during
   *  drawStatic, BEFORE the bars, to stay in the background. */
  /** Skeleton bars (wave shimmer) during `isFetching` — Notion / Linear style
   *  loading feedback on empty cells. */
  private drawSkeletonBars(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport;
    const data = this.data;
    if (!v || !data) return;
    const visibleLeft = v.scrollX;
    const visibleRight = v.scrollX + (w - v.sidebarWidth);
    const visibleTop = v.scrollY;
    const visibleBottom = v.scrollY + (h - v.headerHeight);
    const firstDayIdx = Math.max(0, Math.floor(visibleLeft / v.cellWidth));
    const lastDayIdx = Math.min(v.dayCount - 1, Math.ceil(visibleRight / v.cellWidth));
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const now = performance.now();
    // For each visible row, build a Set of the days (idx) that
    // contain at least one task. The skeleton is then drawn
    // ONLY on runs of consecutive cells without a task.
    // This keeps the real tasks displayed (`keepPreviousData` cache)
    // AND animates the shimmer in the empty cells during the refetch.
    let rowIdx = 0;
    for (const row of data.sortedRows) {
      const rowInfo = this.getEffectiveRowInfo(row.id);
      if (!rowInfo) { rowIdx++; continue; }
      if (rowInfo.y + rowInfo.height < visibleTop) { rowIdx++; continue; }
      if (rowInfo.y > visibleBottom) break;
      if (row.type === "header") { rowIdx++; continue; }
      const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;
      // Mark the days where the row has a task ([startDate;endDate] interval
      // intersects [firstDayIdx;lastDayIdx]).
      const occupied = new Set<number>();
      const slot = data.slotData.get(row.id);
      if (slot) {
        for (const at of slot.tasks) {
          const startIdx = this.daysIso.indexOf(at.startDate);
          const endIdx = this.daysIso.indexOf(at.endDate ?? at.startDate);
          const s = Math.max(firstDayIdx, startIdx >= 0 ? startIdx : 0);
          const e = Math.min(lastDayIdx, endIdx >= 0 ? endIdx : (startIdx >= 0 ? startIdx : 0));
          for (let d = s; d <= e; d++) occupied.add(d);
        }
      }
      // Iterate over runs of consecutive empty cells, draw 1 skeleton
      // per run (width = number of consecutive days).
      let runStart = -1;
      for (let d = firstDayIdx; d <= lastDayIdx + 1; d++) {
        const isEmpty = d <= lastDayIdx && !occupied.has(d);
        if (isEmpty && runStart < 0) {
          runStart = d;
        } else if (!isEmpty && runStart >= 0) {
          const runLen = d - runStart;
          if (runLen > 0) {
            const cellX = v.sidebarWidth + runStart * v.cellWidth - v.scrollX;
            const cellW = runLen * v.cellWidth;
            drawSkeletonCell(ctx, cellX, rowYTop, cellW, rowInfo.height, now, isDark, rowIdx * 7 + runStart * 13);
          }
          runStart = -1;
        }
      }
      rowIdx++;
    }
  }

  private drawHoverCellOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport;
    const cell = this.hoveredCellRef.current;
    if (!v || !cell) return;
    const rowInfo = this.getEffectiveRowInfo(cell.rowId);
    if (!rowInfo) return;
    const dayIdx = this.daysIso.indexOf(cell.dateStr);
    if (dayIdx < 0) return;
    const x = v.sidebarWidth + dayIdx * v.cellWidth - v.scrollX;
    const yTop = v.headerHeight + rowInfo.y - v.scrollY;
    if (x + v.cellWidth < v.sidebarWidth || x > w) return;
    if (yTop + rowInfo.height < v.headerHeight || yTop > h) return;
    const primary = getCssColor("--primary", "rgba(45,45,50,1)");
    ctx.fillStyle = `color-mix(in oklch, ${primary} 10%, transparent)`;
    ctx.fillRect(x, yTop, v.cellWidth, rowInfo.height);
  }

  /** Draws the background cells (weekend, today, holiday, conflicts). */
  private drawGridBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport!;
    const data = this.data!;
    const daysIso = this.daysIso;

    const visibleLeft = v.scrollX;
    const visibleRight = v.scrollX + (w - v.sidebarWidth);
    const firstDayIdx = Math.max(0, Math.floor(visibleLeft / v.cellWidth));
    const lastDayIdx = Math.min(v.dayCount - 1, Math.ceil(visibleRight / v.cellWidth));

    const visibleTop = v.scrollY;
    const visibleBottom = v.scrollY + (h - v.headerHeight);

    // ACTUAL right edge of the grid: stop at the last day, not
    // at the canvas edge. Prevents group banners and bottom horizontal
    // borders from running into the void when the grid is
    // narrower than the visible area (after pagination or with a wide viewport).
    const totalGridPx = v.dayCount * v.cellWidth;
    const gridRightPx = Math.min(w, v.sidebarWidth + totalGridPx - v.scrollX);
    const gridSpan = Math.max(0, gridRightPx - v.sidebarWidth);

    // Why: two passes — otherwise the muted weekend background of row N+1
    // overwrites the bottom horizontal border of row N (the full-height
    // fillRect covers the border pixel just painted).
    // Same for vertical borders if both are mixed within one row.

    // ── Pass 1: all backgrounds ─────────────────────────────────────
    // All rows are snapped to the pixel (rounded yTop / yBot) for
    // an Excel-style render without subpixels: no overflow between row
    // and banner, no thin ghost line between 2 adjacent cells.
    for (const row of data.sortedRows) {
      const rowInfo = this.getEffectiveRowInfo(row.id);
      if (!rowInfo) continue;
      if (rowInfo.y + rowInfo.height < visibleTop) continue;
      if (rowInfo.y > visibleBottom) break;

      const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;
      const yTopR = Math.round(rowYTop);
      const yBotR = Math.round(rowYTop + rowInfo.height);
      const heightR = yBotR - yTopR;

      if (row.type === "header") {
        // Group banner: color across the whole grid (label rendered
        // in the sidebar only, to avoid duplication).
        // Vibrantize for consistency with the task bars (teams/BU).
        const groupColor = vibrantizeColor((row as { color?: string | null }).color ?? "#22c55e");
        ctx.fillStyle = groupColor;
        ctx.fillRect(v.sidebarWidth, yTopR, gridSpan, heightR);
        continue;
      }

      for (let d = firstDayIdx; d <= lastDayIdx; d++) {
        const dateStr = daysIso[d];
        if (!dateStr) continue;
        const x = v.sidebarWidth + d * v.cellWidth - v.scrollX;
        const dateObj = new Date(dateStr);
        const isWeekendReal = isWeekend(dateObj);
        const isTodayReal = isToday(dateObj);
        const holiday = data.holidays.get(dateStr);

        let bg: string | null = null;
        if (isTodayReal) {
          bg = CANVAS_PALETTE.todayCellBg;
        } else if (isWeekendReal) {
          bg = getCssColor("--muted", "#f5f5f8");
        } else if (holiday) {
          bg = holiday.color + "14"; // 8 % alpha hex
        }

        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(x, yTopR, v.cellWidth, heightR);
        }
      }
    }

    // ── Pass 2: all borders (vertical + bottom horizontal + right) ─
    // `fillRect(x, y, 1, h)` is pixel-perfect on DPR=2.
    // All y bounds are rounded (yTopR / yBotR) so nothing
    // overflows by 1 px between rows. The right border (at `gridRightPx`)
    // is also painted on the banners to close the table.
    const borderColor = getGridBorderColor();
    const drawClosingRight = gridRightPx < w;
    const closingRightX = drawClosingRight ? Math.min(w - 1, Math.round(gridRightPx)) : -1;
    for (const row of data.sortedRows) {
      const rowInfo = this.getEffectiveRowInfo(row.id);
      if (!rowInfo) continue;
      if (rowInfo.y + rowInfo.height < visibleTop) continue;
      if (rowInfo.y > visibleBottom) break;

      const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;
      const yTopR = Math.round(rowYTop);
      const yBotR = Math.round(rowYTop + rowInfo.height);
      const heightR = yBotR - yTopR;

      if (row.type === "header") {
        // Banner: no inner vertical borders are drawn,
        // but the table is CLOSED on the right + a thin line is added
        // at the bottom to separate 2 stacked banners (BU + team).
        if (drawClosingRight) {
          ctx.fillStyle = borderColor;
          ctx.fillRect(closingRightX, yTopR, 1, heightR);
        }
        ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
        ctx.fillRect(v.sidebarWidth, yBotR - 1, gridSpan, 1);
        continue;
      }

      ctx.fillStyle = borderColor;
      for (let d = firstDayIdx; d <= lastDayIdx + 1; d++) {
        const x = Math.round(v.sidebarWidth + d * v.cellWidth - v.scrollX);
        ctx.fillRect(x, yTopR, 1, heightR);
      }
      ctx.fillRect(v.sidebarWidth, yBotR - 1, gridSpan, 1);
    }
  }

  /** Draws all task bars visible in the viewport. */
  private drawTasks(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport!;
    const data = this.data!;

    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const visibleLeft = v.scrollX;
    const visibleRight = v.scrollX + (w - v.sidebarWidth);
    const visibleTop = v.scrollY;
    const visibleBottom = v.scrollY + (h - v.headerHeight);
    const animNow = performance.now();

    for (const [rowId, slot] of data.slotData) {
      const rowInfo = this.getEffectiveRowInfo(rowId);
      if (!rowInfo) continue;
      if (rowInfo.y + rowInfo.height < visibleTop) continue;
      if (rowInfo.y > visibleBottom) continue;

      const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;

      for (const at of slot.tasks) {
        // Virtual holidays — special display (colored label)
        if (at.id.startsWith("holiday:")) {
          this.drawHolidayMarker(ctx, at, rowYTop, data.holidays);
          continue;
        }
        // During an active drag/resize, the source bar stays visible
        // but translucent (legacy parity: opacity ~0.35) — no full
        // skip, otherwise the user loses the context of the origin.
        // The drag preview is drawn on top at the target position.
        const drag = this.dragStateRef.current;
        const isDragSource = drag.active && drag.taskId === at.id;
        // In a multi-user resize (users view), the OTHER occurrences
        // of the same task are skipped too: the multi-user preview in
        // drawDragPreview redraws them at the new width. Without this, we
        // would see the other bars at the OLD width during the resize.
        const isOtherOccurrenceOfDragged =
          drag.active &&
          (drag.mode === "resize-left" || drag.mode === "resize-right") &&
          drag.taskId !== null &&
          at.id !== drag.taskId &&
          (() => {
            const realDragId = extractRealTaskId(drag.taskId!);
            // User compound only: the real ID differs from the source compound ID.
            // Otherwise (va:/ra: pseudo-tasks or simple ID): no other occurrence.
            if (realDragId === drag.taskId) return false;
            return at.id.startsWith(`${realDragId}:`);
          })();
        // For resize the skip is kept — the source bar overlaps
        // the preview (same coords except width).
        if (isDragSource && drag.mode !== "move") continue;
        if (isOtherOccurrenceOfDragged) continue;
        // In the users view, `at.id` is a compound `${taskId}:${userId}`
        // so the same task can sit on N rows. In the vehicles/resources view,
        // `at.id` is `va:xxx`/`ra:xxx` (pseudo-task). `extractRealTaskId`
        // handles both cases.
        const realTaskId = extractRealTaskId(at.id);

        // Pending source: while the DropActionMenu (Move/Copy menu) is open
        // the source bar is also translucent to signal
        // that it may move / be copied.
        const pending = this.pendingDropPreview;
        let isPendingSource = false;
        if (pending) {
          const realPendingId = extractRealTaskId(pending.taskId);
          isPendingSource = realTaskId === realPendingId;
        }

        // Position in days relative to the 1st day of the period (can be
        // negative if the task starts before the period, or > dayCount-1 if
        // it ends after). The visible portion is still drawn
        // AND the truncation is noted to: (a) show an indicator arrow,
        // (b) disable resize on the truncated side (not editable without context).
        const firstDay = this.daysIso[0];
        const lastDay = this.daysIso[this.daysIso.length - 1];
        if (!firstDay || !lastDay) continue;
        const taskStart = at.startDate;
        const taskEnd = at.endDate ?? at.startDate;
        const truncatedLeft = taskStart < firstDay;
        const truncatedRight = taskEnd > lastDay;
        // RENDERED bounds, clamped to the period. A task truncated on the
        // left therefore starts at the 1st cell of the period (idx 0);
        // one truncated on the right ends at the last cell. The bar
        // has the same structure as a standard task and slides under the
        // sidebar / scrollbar the same way when scrolling.
        const drawnStartIdx = truncatedLeft
          ? 0
          : differenceInCalendarDays(new Date(taskStart), new Date(firstDay));
        const drawnEndIdx = truncatedRight
          ? v.dayCount - 1
          : differenceInCalendarDays(new Date(taskEnd), new Date(firstDay));
        const taskLeftPx = drawnStartIdx * v.cellWidth;
        const taskWidthPx = (drawnEndIdx - drawnStartIdx + 1) * v.cellWidth;
        if (taskLeftPx + taskWidthPx < visibleLeft) continue;
        if (taskLeftPx > visibleRight) continue;

        const task = this.taskIndex.get(realTaskId);
        if (!task) continue;

        // Local animation (move / resize / appear / delete). Lookup
        // by real ID (in the users view, `at.id` is `${realId}:${userId}`;
        // anims are registered by real ID). Neutral effect (offsets=0,
        // alpha=1, scaleX=1) when no anim is active.
        const effect = this.getAnimEffect(realTaskId, animNow);

        // Pixel position of the bar + move/resize animation offsets.
        // barTop snapped to the pixel (rounded rowYTop) so the bar does not
        // overflow by 1 px onto the next row (visible when a
        // group banner follows the row → the bar seemed to overlap).
        const barLeft = v.sidebarWidth + taskLeftPx - v.scrollX + 4 + effect.offsetX;
        const barWidth = Math.max(taskWidthPx - 8 + effect.offsetWidth, 12);
        const barTop =
          Math.round(rowYTop) +
          at.slot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) +
          CANVAS_GEOMETRY.rowPadding +
          effect.offsetY;

        // Combine the animation alpha + the "drag/pending source" alpha (0.35).
        // The source bar stays visible and translucent to keep the
        // origin context during the drag (legacy parity).
        const sourceAlpha = isDragSource || isPendingSource ? 0.35 : 1;
        const finalAlpha = effect.alpha * sourceAlpha;
        const needsTransform = finalAlpha !== 1 || effect.scaleX !== 1;
        if (needsTransform) {
          ctx.save();
          if (finalAlpha !== 1) ctx.globalAlpha *= finalAlpha;
          if (effect.scaleX !== 1) {
            const cx = barLeft + barWidth / 2;
            const cy = barTop + this.getBarHeight() / 2;
            ctx.translate(cx, cy);
            ctx.scale(effect.scaleX, 1);
            ctx.translate(-cx, -cy);
          }
        }
        this.drawTaskBar(ctx, task, barLeft, barTop, barWidth, truncatedLeft, truncatedRight);
        if (needsTransform) {
          ctx.restore();
        }
      }
    }
  }

  /** Draws a complete task bar (background + text + icons). */
  private drawTaskBar(
    ctx: CanvasRenderingContext2D,
    task: TaskWithUsers,
    x: number,
    y: number,
    width: number,
    /** Task truncated on the left (starts before the visible period). */
    truncatedLeft: boolean = false,
    /** Task truncated on the right (ends after the visible period). */
    truncatedRight: boolean = false,
  ): void {
    const data = this.data!;
    const status = task.statusId ? data.statusMap.get(task.statusId) : undefined;
    // Subtle saturation/lightness boost to make colors more
    // vivid in the canvas render — the DB data is not modified.
    const bgColor = vibrantizeColor(task.project?.color ?? status?.color ?? "#3b82f6");
    // Why: in the users view, `hoveredTaskIdRef.current` is a compound
    // `${realId}:${userId}` but `task.id` is the real ID. We extract
    // the real ID to compare (otherwise the hover brightness + the
    // resize handles never show in the users view).
    const hoveredRaw = this.hoveredTaskIdRef.current;
    const hoveredReal = hoveredRaw ? extractRealTaskId(hoveredRaw) : hoveredRaw;
    const isHovered = hoveredReal === task.id;
    const baseColor = isHovered ? brightenColor(bgColor, 1.1) : bgColor;
    const height = this.getBarHeight();
    const radius = CANVAS_GEOMETRY.barCornerRadius;

    // Determine the timeSlot for the half-day gradient
    const timeSlot: TaskTimeSlot = getTaskTimeSlot(task.startTime, task.endTime);

    // Rounded rectangle background: solid color for all-day/custom, 50/50
    // two-tone gradient for morning/afternoon (legacy DOM parity).
    if (timeSlot === "morning") {
      const grad = ctx.createLinearGradient(x, 0, x + width, 0);
      grad.addColorStop(0, baseColor);
      grad.addColorStop(0.5, baseColor);
      grad.addColorStop(0.5, "rgb(255,255,255)");
      grad.addColorStop(1, "rgb(255,255,255)");
      ctx.fillStyle = grad;
    } else if (timeSlot === "afternoon") {
      const grad = ctx.createLinearGradient(x, 0, x + width, 0);
      grad.addColorStop(0, "rgb(255,255,255)");
      grad.addColorStop(0.5, "rgb(255,255,255)");
      grad.addColorStop(0.5, baseColor);
      grad.addColorStop(1, baseColor);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = baseColor;
    }
    this.fillRoundedRect(ctx, x, y, width, height, radius);

    // Inset border (subtle)
    ctx.strokeStyle = CANVAS_PALETTE.taskBarBorderLight;
    ctx.lineWidth = 1;
    this.strokeRoundedRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, radius);

    // Label + icon colors depending on timeSlot (see legacy taskBarIconColor)
    const labelColor = getTaskBarLabelColor(bgColor, timeSlot);
    const iconColor = getTaskBarIconColor(bgColor, timeSlot);

    // Truncated task (= overflows the schedule period). Since the bar
    // is clamped to the period bounds at allocation time, x and width
    // already match the rendered portion. The arrow and the text simply
    // align with the bar edge — no clamp to the sidebar
    // and no clip-rect to apply. Same behavior as a standard
    // task: everything slides under the sidebar while scrolling.
    const arrowGutter = 12;
    const showLeftArrow = truncatedLeft;
    const showRightArrow = truncatedRight;
    const visibleLeftEdge = x;
    const visibleRightEdge = x + width;
    let cursorX = visibleLeftEdge + CANVAS_GEOMETRY.barPaddingX + (showLeftArrow ? arrowGutter : 0);
    const iconY = y + (height - ICON_SIZE_DEFAULT) / 2;

    // Icons before the label
    if (task.startTime) {
      drawCanvasIcon(ctx, CANVAS_ICONS.clock, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }
    if (task.parentId) {
      drawCanvasIcon(ctx, CANVAS_ICONS.parent, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }
    const fileCount = (task as unknown as { fileCount?: number }).fileCount ?? task.files?.length ?? 0;
    if (data.showFileIcon && fileCount > 0) {
      drawCanvasIcon(ctx, CANVAS_ICONS.file, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }
    if ((task as unknown as { hasConflict?: boolean }).hasConflict) {
      drawCanvasIcon(ctx, CANVAS_ICONS.conflict, cursorX, y + (height - ICON_SIZE_MEDIUM) / 2, ICON_SIZE_MEDIUM);
      cursorX += getIconLayoutWidth(ICON_SIZE_MEDIUM, CANVAS_GEOMETRY.barGapX);
    }
    if (task.isLocked) {
      drawCanvasIcon(ctx, CANVAS_ICONS.locked, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }
    const vehicleNames = (task as unknown as { vehicleNames?: string[] }).vehicleNames;
    if (vehicleNames && vehicleNames.length > 0) {
      drawCanvasIcon(ctx, CANVAS_ICONS.vehicle, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }
    const resourceNames = (task as unknown as { resourceNames?: string[] }).resourceNames;
    if (resourceNames && resourceNames.length > 0) {
      drawCanvasIcon(ctx, CANVAS_ICONS.resource, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }
    const userCount = task.users?.length ?? 0;
    if (data.showUserCount && userCount > 1) {
      drawCanvasIcon(ctx, CANVAS_ICONS.users, cursorX, iconY, ICON_SIZE_DEFAULT, iconColor);
      cursorX += getIconLayoutWidth(ICON_SIZE_DEFAULT, CANVAS_GEOMETRY.barGapX);
    }

    // Truncated label — no halo (the legacy has none either, contrast
    // comes from the two-tone gradient of the background + text on half days).
    // Bold/italic/underline/strikethrough style depending on the status (legacy parity).
    const baseWeight = data.fontBold ? "600" : "400";
    const fontWeight = status?.bold ? "700" : baseWeight;
    const fontStyle = status?.italic ? "italic" : "normal";
    const fontFamily = data.fontFamily || "Geist Sans, ui-sans-serif, system-ui, sans-serif";
    ctx.font = `${fontStyle} ${fontWeight} ${data.cellFontSize ?? 11}px ${fontFamily}`;
    const labelEnd = visibleRightEdge - CANVAS_GEOMETRY.barPaddingX - (showRightArrow ? arrowGutter : 0);
    const labelMaxWidth = Math.max(0, labelEnd - cursorX);
    const label = this.computeTaskLabel(task);
    const fitted = fitText(ctx, label, labelMaxWidth);
    if (fitted) {
      const textY = y + height / 2 + 0.5;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      if (timeSlot === "morning" || timeSlot === "afternoon") {
        // Two-tone gradient aligned on the whole BAR (split at 50% of the
        // bar, not of the label) — exact parity with the legacy task-bar.tsx.
        const colored = getContrastColor(bgColor);
        const onWhite = "#000000";
        const leftColor = timeSlot === "morning" ? colored : onWhite;
        const rightColor = timeSlot === "morning" ? onWhite : colored;
        const splitX = x + width / 2;
        // Left half
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, splitX - x, height);
        ctx.clip();
        ctx.fillStyle = leftColor;
        ctx.fillText(fitted, cursorX, textY);
        ctx.restore();
        // Right half
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, y, x + width - splitX, height);
        ctx.clip();
        ctx.fillStyle = rightColor;
        ctx.fillText(fitted, cursorX, textY);
        ctx.restore();
      } else {
        // all-day / custom: solid color (W3C contrast)
        ctx.fillStyle = labelColor;
        ctx.fillText(fitted, cursorX, textY);
      }
      // Underline / strikethrough (status)
      if (status?.underline || status?.strikethrough) {
        const metrics = ctx.measureText(fitted);
        const lineY = status.strikethrough
          ? Math.round(textY) + 0.5
          : Math.round(textY + 5) + 0.5;
        ctx.strokeStyle = labelColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cursorX, lineY);
        ctx.lineTo(cursorX + metrics.width, lineY);
        ctx.stroke();
      }
    }

    // Resize handles — visible ONLY when the bar is hovered, unless the
    // task is locked. Legacy parity: 6 px wide, rgba(0,0,0,0.35).
    // Truncated sides (task overflowing the period) show no
    // handle: resizing is impossible without knowing the out-of-period limit.
    // Hourly tasks (with startTime): no resize in the days view — a
    // 1 h task cannot be stretched onto the next day, it makes
    // no sense. Resize stays available in the hours view.
    // Non-resizable task (`tasks:resize` permission disabled
    // or insufficient edit scope): no handle drawn either,
    // so as not to suggest an action the user cannot perform.
    // Lookup via realIdToCanResize (keyed by real ID — shared across
    // all variants in the users view). The boolean is computed
    // upstream by `use-planning-data` (handles real task / vehicleAssignment
    // / resourceAssignment depending on the module permissions).
    const isHourly = !!task.startTime;
    const canResizeTask = this.realIdToCanResize.get(task.id) !== false;
    const canResize = isHovered && !task.isLocked && !isHourly && canResizeTask;
    if (canResize) {
      const handleW = CANVAS_GEOMETRY.resizeHandleWidth;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      if (!truncatedLeft) {
        this.fillRoundedRect(ctx, x, y, handleW, height, radius, "left");
      }
      if (!truncatedRight) {
        this.fillRoundedRect(ctx, x + width - handleW, y, handleW, height, radius, "right");
      }
    }

    // Truncation indicators: small arrow rendered on the VISIBLE side to
    // signal that the task extends beyond the period OR beyond the
    // viewport. The arrow points outward (◀ / ▶).
    if (showLeftArrow || showRightArrow) {
      const arrowSize = 6;
      const arrowY = y + height / 2;
      ctx.fillStyle = labelColor;
      if (showLeftArrow) {
        const ax = visibleLeftEdge + 4;
        ctx.beginPath();
        ctx.moveTo(ax, arrowY);
        ctx.lineTo(ax + arrowSize, arrowY - arrowSize / 2);
        ctx.lineTo(ax + arrowSize, arrowY + arrowSize / 2);
        ctx.closePath();
        ctx.fill();
      }
      if (showRightArrow) {
        // The right arrow is anchored to the bar edge, BUT shifted
        // by the width of the vertical scrollbar (~14 px) so that the
        // last cell of the period — which touches the right edge of the
        // canvas when scrolled all the way — leaves the arrow visible
        // left of the scrollbar. The offset is applied
        // permanently (no conditional clamping) → the arrow moves
        // predictably with the bar throughout the scroll, without
        // a sticky effect.
        const SCROLLBAR_OFFSET = 14;
        const ax = visibleRightEdge - 4 - SCROLLBAR_OFFSET;
        ctx.beginPath();
        ctx.moveTo(ax, arrowY);
        ctx.lineTo(ax - arrowSize, arrowY - arrowSize / 2);
        ctx.lineTo(ax - arrowSize, arrowY + arrowSize / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Draws a public holiday marker (colored label on the cell). */
  private drawHolidayMarker(
    ctx: CanvasRenderingContext2D,
    at: AllocatedTask,
    rowYTop: number,
    holidays: CanvasRenderData["holidays"]
  ): void {
    const v = this.viewport!;
    const dateStr = at.startDate;
    const holiday = holidays.get(dateStr);
    if (!holiday) return;
    const dayIdx = this.daysIso.indexOf(dateStr);
    if (dayIdx < 0) return;

    const x = v.sidebarWidth + dayIdx * v.cellWidth - v.scrollX + 1;
    const y = rowYTop + at.slot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) + CANVAS_GEOMETRY.rowPadding;
    const w = v.cellWidth - 2;
    const height = this.getBarHeight();

    // Semi-transparent colored background
    ctx.fillStyle = holiday.color + "30"; // 30/255 = ~19 % alpha
    this.fillRoundedRect(ctx, x, y, w, height, CANVAS_GEOMETRY.barCornerRadius);

    ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = holiday.color;
    ctx.textBaseline = "middle";
    const fitted = fitText(ctx, holiday.label, w - 4);
    if (fitted) ctx.fillText(fitted, x + 2, y + height / 2);
  }

  /** Draws the left (sticky) sidebar: row labels. */
  private drawSidebar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport!;
    const data = this.data!;

    // Sidebar background (covers the cells underneath)
    const bgColor = getCssColor("--background", "#ffffff");
    const fgColor = getCssColor("--foreground", "#0f172a");
    const borderColor = "rgb(200, 205, 215)";
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, v.headerHeight, v.sidebarWidth, h - v.headerHeight);

    const visibleTop = v.scrollY;
    const visibleBottom = v.scrollY + (h - v.headerHeight);

    for (const row of data.sortedRows) {
      const rowInfo = this.getEffectiveRowInfo(row.id);
      if (!rowInfo) continue;
      if (rowInfo.y + rowInfo.height < visibleTop) continue;
      if (rowInfo.y > visibleBottom) break;
      const yTop = v.headerHeight + rowInfo.y - v.scrollY;
      const yTopR = Math.round(yTop);
      const yBotR = Math.round(yTop + rowInfo.height);
      const heightR = yBotR - yTopR;
      const yMid = yTopR + heightR / 2;

      if (row.type === "header") {
        // Group banner: group color across the whole sidebar,
        // auto-contrast white/black text, font-semibold 11 px (DOM parity).
        // Vibrantize for visual consistency with the bars and the grid area.
        const groupColor = vibrantizeColor((row as { color?: string | null }).color ?? "#22c55e");
        ctx.fillStyle = groupColor;
        ctx.fillRect(0, yTopR, v.sidebarWidth, heightR);
        const fgColor = getContrastColor(groupColor);
        // Optional icon depending on the level (Building2 for BU, UsersRound
        // for team). Same as the sidebar menu icons: visual consistency
        // between nav and schedule, the user spots the level faster.
        const iconName = headerIconFor(row.id);
        let textX = 12;
        if (iconName) {
          const iconSize = 14;
          drawCanvasIcon(ctx, CANVAS_ICONS[iconName], textX, yMid - iconSize / 2, iconSize, fgColor);
          textX += iconSize + 6;
        }
        ctx.fillStyle = fgColor;
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        // Text confined to the sidebar width (users).
        // If too long → truncated with "..." by fitText. The hover
        // tooltip (kind: "group-header") shows the full name.
        const fitted = fitText(ctx, row.name ?? "", v.sidebarWidth - textX - 12);
        ctx.fillText(fitted, textX, yMid);
        // Thin line at the bottom of the banner on the sidebar side (consistent with the grid)
        ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
        ctx.fillRect(0, yBotR - 1, v.sidebarWidth, 1);
        continue;
      }

      // User/project/place row: round avatar (toggle) + name.
      // If the user has a profile picture (`row.image`), the image is
      // loaded via the global cache and drawn clipped to a circle.
      // Fallback (no image / not loaded yet / error): colored disc
      // with initials.
      const userColor = (row as { color?: string | null }).color ?? "#6b7280";
      const showAvatar = data.showRowAvatar !== false;
      let textX = 12;
      if (showAvatar) {
        const avatarSize = 20;
        const avatarCx = 8 + avatarSize / 2;
        const avatarCy = yMid;

        const imageField = (row as { image?: string | null }).image ?? null;
        const avatarUrl = buildAvatarUrl(imageField);
        const cachedImg = avatarUrl
          ? getCachedAvatar(avatarUrl, () => {
              // Image arrived → force a redraw of the static layer.
              this.staticDirty = true;
            })
          : null;

        if (cachedImg) {
          // Profile picture available: drawImage clipped to a circle.
          // imageSmoothing is temporarily enabled (disabled by
          // default for the rest of the render — text, 1 px lines on
          // fractional DPR) so the picture is smoothed instead
          // of pixelated when downscaled.
          ctx.save();
          const prevSmoothing = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.beginPath();
          ctx.arc(avatarCx, avatarCy, avatarSize / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(
            cachedImg,
            avatarCx - avatarSize / 2,
            avatarCy - avatarSize / 2,
            avatarSize,
            avatarSize,
          );
          ctx.imageSmoothingEnabled = prevSmoothing;
          ctx.restore();
        } else {
          // Initials fallback on a colored disc.
          ctx.fillStyle = userColor;
          ctx.beginPath();
          ctx.arc(avatarCx, avatarCy, avatarSize / 2, 0, Math.PI * 2);
          ctx.fill();
          const initials = computeInitials(row.name ?? "");
          ctx.fillStyle = getContrastColor(userColor);
          ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initials, avatarCx, avatarCy + 0.5);
        }
        textX = 8 + avatarSize + 8;
      }

      // Name to the right of the avatar (or left-aligned without avatar);
      // users view: contract type suffix, like the hours view.
      ctx.fillStyle = fgColor;
      ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      let displayName = row.name ?? "";
      if (data.viewMode === "users") {
        const suffix = getContractSuffix(
          (row as { contractType?: string | null }).contractType,
          (key) => this.i18n.contractLabels[key] ?? "",
        );
        if (suffix) displayName = `${displayName} [${suffix}]`;
      }
      const fittedName = fitText(ctx, displayName, v.sidebarWidth - textX - 8);
      ctx.fillText(fittedName, textX, yMid);

      // Bottom border of the row (pixel-perfect via fillRect)
      ctx.fillStyle = borderColor;
      ctx.fillRect(0, yBotR - 1, v.sidebarWidth, 1);
    }

    // Right border of the sidebar — painted in segments to skip
    // group banners ("header" rows). Without this, the gray
    // line visually cuts each colored banner between the
    // sidebar/grid → "cut-out" look. With consistent rounding
    // (yTopR / yBotR) the line does not overflow by 1 px onto the banner.
    ctx.fillStyle = borderColor;
    const sidebarRightX = Math.round(v.sidebarWidth);
    for (const row of data.sortedRows) {
      if (row.type === "header") continue;
      const rowInfo = this.rowIdToY.get(row.id);
      if (!rowInfo) continue;
      const rowYTop = v.headerHeight + rowInfo.y - v.scrollY;
      if (rowYTop + rowInfo.height < v.headerHeight) continue;
      if (rowYTop > h) break;
      const yTopR = Math.round(Math.max(rowYTop, v.headerHeight));
      const yBotR = Math.round(Math.min(rowYTop + rowInfo.height, h));
      if (yBotR > yTopR) {
        ctx.fillRect(sidebarRightX, yTopR, 1, yBotR - yTopR);
      }
    }
  }

  /**
   * "Sticky" group banners reproduced under the timeline header when
   * their native counterparts (row.type === "header") are scrolled off screen.
   *
   * Handles 2 hierarchical LEVELS (BU + team) when the sort mode
   * produces them (`custom-bu-team`, `custom-bu-user`, `custom-bu-group`):
   *   - level 1 = BU      → id `header-bu-XXX`
   *   - level 2 = team    → id `header-bu-XXX-team-YYY`
   * With the other sort modes, a single level is sticky.
   *
   * Push effect: when the next banner of the same level enters the
   * viewport, the current one is "pushed" upward. The upper level (BU)
   * stays until its next BU pushes it in turn.
   *
   * Drawn BEFORE `drawHeader` so the timeline covers the sticky banners
   * at the top during the transition (slide-under-the-days
   * effect, as requested by UX).
   */
  private drawStickyGroupHeader(ctx: CanvasRenderingContext2D, w: number): void {
    if (!this.data || !this.viewport) return;
    const data = this.data;
    const v = this.viewport;
    if (v.scrollY <= 0) return;

    // Right limit of the banner = end of the grid (= last visible column),
    // not the full canvas width. Otherwise, when the grid does not fill
    // the whole width (partial week / hours < 24), the sticky banner
    // overflows onto the "empty" area on the right, which looks wrong.
    const totalGridPx = v.dayCount * v.cellWidth;
    const gridRightPx = Math.min(w, v.sidebarWidth + totalGridPx - v.scrollX);

    // Level of a header from its id:
    //  - "header-bu-XXX-team-YYY" → level 2 (team child of a BU)
    //  - anything else          → level 1 (standalone BU, standalone team, group, etc.)
    const headerLevel = (id: string): 1 | 2 =>
      id.startsWith("header-bu-") && id.includes("-team-") ? 2 : 1;

    type Active = { row: { id: string; name?: string | null; color?: string | null }; height: number; parentBuId: string | null };
    let active1: Active | null = null;
    let next1Y: number | null = null;
    let active2: Active | null = null;
    let next2Y: number | null = null;
    // Track the "current" BU during the walk so the right
    // `parentBuId` can be attached to each team header. Lets us filter out later
    // (line ~`active2.parentBuId !== active1.row.id`) the sticky team of a
    // different BU — otherwise glitch when scrolling from one BU to another.
    let currentBuId: string | null = null;

    for (const row of data.sortedRows) {
      if (row.type !== "header") continue;
      const info = this.getEffectiveRowInfo(row.id);
      if (!info) continue;
      const level = headerLevel(row.id);
      if (level === 1) currentBuId = row.id;

      // "Becomes sticky" threshold — SHIFTED down for level 2 by
      // the height of the level 1 sticky. The inline team thus slides to
      // its final sticky position (just under the sticky BU) WITHOUT A JUMP:
      // at the exact moment it enters the area reserved for level 2
      // (= under the sticky BU banner), the sticky takes over and
      // covers the remaining inline render — no more "truncated" banner
      // visible behind the sticky BU.
      const a1: Active | null = active1;
      let threshold: number;
      if (level === 1) {
        threshold = v.scrollY;
      } else {
        threshold = v.scrollY + (a1 ? a1.height : 0);
      }
      if (info.y <= threshold) {
        if (level === 1) {
          active1 = { row, height: info.height, parentBuId: null };
        } else {
          // Update active2 ONLY if the team found belongs to the BU
          // currently sticky (= active1). Otherwise it is a team of an
          // upcoming BU already inside "sticky zone 2" — taking it
          // as active2 would hide the last team of the current
          // BU (see parentBuId guard below) and the inline BU2
          // would become visible behind the lvl2 sticky zone, creating a
          // visual glitch (the new BU "goes over" the team).
          if (!active1 || currentBuId === active1.row.id) {
            active2 = { row, height: info.height, parentBuId: currentBuId };
          }
        }
      } else {
        if (level === 1 && next1Y === null) next1Y = info.y;
        // Level 2 push effect valid ONLY if the next team
        // is under the same BU as active1. Otherwise the current team
        // has no "successor" in its BU and must stay sticky until
        // the next BU hides it (via parentBuId mismatch).
        if (level === 2 && next2Y === null && a1 && currentBuId === a1.row.id) {
          next2Y = info.y;
        }
        if (next1Y !== null && next2Y !== null) break;
      }
    }
    if (!active1 && !active2) return;
    // Guard: if the active team belongs to ANOTHER BU than the one
    // currently sticky, ignore it (transition between 2 BUs, the push effect
    // already moved the BU and the old BU's team no longer makes sense).
    if (active1 && active2 && active2.parentBuId !== null && active2.parentBuId !== active1.row.id) {
      active2 = null;
    }

    // Computes the final position of a banner with the push effect:
    //  - bottom = bottom position of the "pushing" banner (next) when close
    //  - otherwise = stays at top (yTop = baseY)
    const computeY = (baseY: number, height: number, nextY: number | null): number => {
      if (nextY === null) return baseY;
      const nextOnScreen = v.headerHeight + nextY - v.scrollY;
      if (nextOnScreen < baseY + height) return nextOnScreen - height;
      return baseY;
    };

    // Level 1 (BU) right under the timeline header, level 2 (team) under level 1
    const lvl1Y = active1 ? computeY(v.headerHeight, active1.height, next1Y) : 0;
    const lvl2BaseY = v.headerHeight + (active1 ? active1.height : 0);
    let lvl2Y = active2 ? computeY(lvl2BaseY, active2.height, next2Y) : 0;
    // Extra push: when the NEXT BU approaches (next1Y), it
    // must also push the sticky team upward, otherwise the inline BU2
    // (sliding up from below) overlaps the sticky team banner when
    // reaching the top — the user then sees the new BU slide under
    // the team. By pushing the team in sync with lvl1, both
    // levels leave the viewport together and BU2 takes the whole
    // space visually when it arrives.
    if (active2 && next1Y !== null) {
      const buNextOnScreen = v.headerHeight + next1Y - v.scrollY;
      if (buNextOnScreen < lvl2BaseY + active2.height) {
        const pushedByBu = buNextOnScreen - active2.height;
        if (pushedByBu < lvl2Y) lvl2Y = pushedByBu;
      }
    }

    // Render order: TEAM FIRST, then BU on top. When the push effect
    // shifts the team upward (pushed out by a new team), it can
    // slide under the BU banner area — the BU must then cover it
    // (otherwise the team goes over the BU, which looks wrong).
    if (active2) this.drawStickyBand(ctx, gridRightPx, v, active2.row, lvl2Y, active2.height);
    if (active1) this.drawStickyBand(ctx, gridRightPx, v, active1.row, lvl1Y, active1.height);
  }

  /** Renders a single sticky banner (1:1 parity with the native banners
   *  : full-width vibrantized color + truncated label on the sidebar side +
   *  30% black line at the bottom). */
  private drawStickyBand(
    ctx: CanvasRenderingContext2D,
    gridRightPx: number,
    v: NonNullable<typeof this.viewport>,
    row: { id: string; name?: string | null; color?: string | null },
    y: number,
    height: number,
  ): void {
    const yTopR = Math.round(y);
    const heightR = Math.round(height);
    const yBotR = yTopR + heightR;
    const yMid = yTopR + heightR / 2;
    const color = vibrantizeColor(row.color ?? "#22c55e");
    ctx.fillStyle = color;
    // Width limited to `gridRightPx` (end of the visible grid), not the
    // full canvas — otherwise the banner overflows onto the empty area on the right
    // (partial week, hours view < 24 cells).
    ctx.fillRect(0, yTopR, gridRightPx, heightR);
    const fgColor = getContrastColor(color);
    // Building2 / UsersRound icon depending on the header level (parity with
    // the inline render in drawSidebar — the sticky must be indistinguishable
    // from the scrolling version in terms of visual content).
    const iconName = headerIconFor(row.id);
    let textX = 12;
    if (iconName) {
      const iconSize = 14;
      drawCanvasIcon(ctx, CANVAS_ICONS[iconName], textX, yMid - iconSize / 2, iconSize, fgColor);
      textX += iconSize + 6;
    }
    ctx.fillStyle = fgColor;
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const fitted = fitText(ctx, row.name ?? "", v.sidebarWidth - textX - 12);
    ctx.fillText(fitted, textX, yMid);
    ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
    ctx.fillRect(0, yBotR - 1, gridRightPx, 1);
  }

  /** Draws the timeline header (3 rows month/week/day, sticky).
   *  Heights: month 28 px / week 22 px / day 46 px = 96 px total. */
  private drawHeader(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport!;
    if (v.headerHeight <= 0) return;

    const monthH = CANVAS_GEOMETRY.headerMonthHeight;
    const weekH = CANVAS_GEOMETRY.headerWeekHeight;
    const dayH = CANVAS_GEOMETRY.headerDayHeight;
    const monthY = 0;
    const weekY = monthH;
    const dayY = monthH + weekH;

    const bgColor = getCssColor("--background", "#ffffff");
    const mutedBg = getCssColor("--muted", "#f5f5f8");
    const mutedFg = getCssColor("--muted-foreground", "#71717a");
    const fgColor = getCssColor("--foreground", "#0f172a");
    // Header border color — matches the grid for visual
    // consistency (legacy parity with shadcn `--border` ≈ rgb(228, 230, 235)).
    const borderColor = getGridBorderColor();

    // Global header background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, v.headerHeight);

    const visibleLeft = v.scrollX;
    const visibleRight = v.scrollX + (w - v.sidebarWidth);
    const firstDayIdx = Math.max(0, Math.floor(visibleLeft / v.cellWidth));
    const lastDayIdx = Math.min(v.dayCount - 1, Math.ceil(visibleRight / v.cellWidth));

    // ACTUAL right edge: stop at the last day, not at the canvas
    // edge — otherwise the horizontal lines and the muted background of the
    // weeks run into the void on the right.
    const totalGridPx = v.dayCount * v.cellWidth;
    const gridRightPx = Math.min(w, v.sidebarWidth + totalGridPx - v.scrollX);
    const gridSpan = Math.max(0, gridRightPx - v.sidebarWidth);

    // ──────────────────────────────────────────────────────────────────
    // Row 1 — Months (e.g. "Janvier 2026")
    // ──────────────────────────────────────────────────────────────────
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = fgColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let curMonthStart = -1;
    let curMonthLabel = "";
    for (let d = firstDayIdx; d <= lastDayIdx; d++) {
      const dateStr = this.daysIso[d];
      if (!dateStr) continue;
      const capitalized = this.getDayHeaderLabels(dateStr).month;
      if (capitalized !== curMonthLabel) {
        if (curMonthStart >= 0) {
          this.drawMonthCell(ctx, curMonthStart, d - 1, curMonthLabel, monthY, monthH);
        }
        curMonthLabel = capitalized;
        curMonthStart = d;
      }
    }
    if (curMonthStart >= 0) {
      this.drawMonthCell(ctx, curMonthStart, lastDayIdx, curMonthLabel, monthY, monthH);
    }

    // ──────────────────────────────────────────────────────────────────
    // Row 2 — Weeks (e.g. "S3", "S4") on a muted background
    // ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = mutedBg;
    ctx.fillRect(v.sidebarWidth, weekY, gridSpan, weekH);
    ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = mutedFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let curWeekStart = -1;
    let curWeekLabel = "";
    for (let d = firstDayIdx; d <= lastDayIdx; d++) {
      const dateStr = this.daysIso[d];
      if (!dateStr) continue;
      const week = this.getDayHeaderLabels(dateStr).week;
      if (week !== curWeekLabel) {
        if (curWeekStart >= 0) {
          this.drawWeekCell(ctx, curWeekStart, d - 1, curWeekLabel, weekY, weekH);
        }
        curWeekLabel = week;
        curWeekStart = d;
      }
    }
    if (curWeekStart >= 0) {
      this.drawWeekCell(ctx, curWeekStart, lastDayIdx, curWeekLabel, weekY, weekH);
    }

    // ──────────────────────────────────────────────────────────────────
    // Row 3 — Days (stacked letter + number, today = orange badge)
    // ──────────────────────────────────────────────────────────────────
    for (let d = firstDayIdx; d <= lastDayIdx; d++) {
      const dateStr = this.daysIso[d];
      if (!dateStr) continue;
      const date = new Date(dateStr);
      const x = v.sidebarWidth + d * v.cellWidth - v.scrollX;
      const isWeekendReal = isWeekend(date);
      const isTodayReal = isToday(date);
      const holiday = this.data?.holidays.get(dateStr);

      // Day cell background — priority: today > weekend > holiday > default.
      // Consistent with drawGridBackground (the grid cells
      // below have the same holiday tint + 8 % alpha).
      if (isTodayReal) {
        ctx.fillStyle = CANVAS_PALETTE.todayCellBg;
      } else if (isWeekendReal) {
        ctx.fillStyle = mutedBg;
      } else if (holiday) {
        ctx.fillStyle = holiday.color + "14"; // 8 % alpha hex
      } else {
        ctx.fillStyle = bgColor;
      }
      ctx.fillRect(x, dayY, v.cellWidth, dayH);

      // Day letter (L, M, M, J, V, S, D) — at the top, size 10 px.
      // textBaseline=middle + centerY=dayY+12 gives a visual top
      // padding equal to the number's bottom padding (symmetry).
      // Today: bold letter (parity with the bold today number).
      const letter = this.getDayHeaderLabels(dateStr).letter;
      ctx.font = isTodayReal
        ? "700 10px ui-sans-serif, system-ui, sans-serif"
        : "500 10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = isTodayReal
        ? CANVAS_PALETTE.orange600
        : isWeekendReal
        ? mutedFg
        : mutedFg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x + v.cellWidth / 2, dayY + 12);

      // Day number — at the bottom. Today = round orange-500 badge.
      const dayNum = format(date, "d");
      const numberCenterY = dayY + dayH - 13;
      if (isTodayReal) {
        ctx.fillStyle = CANVAS_PALETTE.orange500;
        ctx.beginPath();
        ctx.arc(x + v.cellWidth / 2, numberCenterY, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(dayNum, x + v.cellWidth / 2, numberCenterY);
      } else {
        ctx.fillStyle = isWeekendReal ? mutedFg : fgColor;
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(dayNum, x + v.cellWidth / 2, numberCenterY);
      }

    }

    // ──────────────────────────────────────────────────────────────────
    // Vertical borders (separate pass)
    //
    // Why: painting the borders in the same loop as the day
    // backgrounds breaks the render — the `fillRect(x, dayY, cellWidth, dayH)`
    // of day D+1 starts exactly at xRight of day D and overwrites the
    // right border just painted. Only the border of the last
    // visible day survives. In a separate pass after all backgrounds, nothing
    // gets overwritten.
    // ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = borderColor;
    for (let d = firstDayIdx; d <= lastDayIdx; d++) {
      const dateStr = this.daysIso[d];
      if (!dateStr) continue;
      const date = new Date(dateStr);
      const x = v.sidebarWidth + d * v.cellWidth - v.scrollX;
      const xRight = Math.round(x + v.cellWidth);
      const nextDateStr = this.daysIso[d + 1];
      const nextDate = nextDateStr ? new Date(nextDateStr) : null;
      const weekChanges = nextDate
        ? getISOWeek(nextDate) !== getISOWeek(date)
        : false;
      const monthChanges = nextDate
        ? format(nextDate, "yyyy-MM") !== format(date, "yyyy-MM")
        : false;
      // DAY row: line between all days (dayY → headerHeight)
      ctx.fillRect(xRight, dayY, 1, v.headerHeight - dayY);
      // WEEK row: line only at week transitions
      if (weekChanges) {
        ctx.fillRect(xRight, weekY, 1, dayY - weekY);
      }
      // MONTH row: line only at month transitions
      if (monthChanges) {
        ctx.fillRect(xRight, monthY, 1, weekY - monthY);
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // Top-left corner (sidebar / header intersection)
    // ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, v.sidebarWidth, v.headerHeight);
    // On the week row, the corner has a muted background like the rest
    ctx.fillStyle = mutedBg;
    ctx.fillRect(0, weekY, v.sidebarWidth, weekH);
    // « Sem. » / « Wk » label right-aligned on the week row
    ctx.fillStyle = mutedFg;
    ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(this.i18n.labels.weekAbbr, v.sidebarWidth - 8, weekY + weekH / 2);

    // Borders between the header rows (pixel-perfect via fillRect).
    // Limited to the right edge of the grid so they do not run
    // into the void on the right when the grid is narrower than w.
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, weekY, gridRightPx, 1);                              // month ↔ week
    ctx.fillRect(0, dayY, gridRightPx, 1);                               // week ↔ day
    ctx.fillRect(Math.round(v.sidebarWidth), 0, 1, v.headerHeight); // sidebar right edge
    ctx.fillRect(0, v.headerHeight, gridRightPx, 1);                     // header bottom
    // Right border closing the header at the last visible day (Excel-style).
    if (gridRightPx < w) {
      const rightX = Math.min(w - 1, Math.round(gridRightPx));
      ctx.fillRect(rightX, 0, 1, v.headerHeight);
    }
  }

  private drawMonthCell(
    ctx: CanvasRenderingContext2D,
    startIdx: number,
    endIdx: number,
    label: string,
    yTop: number,
    height: number
  ): void {
    const v = this.viewport!;
    const cellLeft = v.sidebarWidth + startIdx * v.cellWidth - v.scrollX;
    const cellRight = cellLeft + (endIdx - startIdx + 1) * v.cellWidth;
    // Sticky-left: while the cell is partially visible, the label
    // sticks to the left edge of the grid area (right after the
    // sidebar) rather than to `cellLeft`, which can be negative after
    // scrolling. Without this, "Mai 2026" got cut to "26" because
    // its origin was off screen on the left.
    const padX = 8;
    const visibleLeft = v.sidebarWidth;
    const labelX = Math.max(cellLeft, visibleLeft) + padX;
    const availableWidth = cellRight - padX - labelX;
    if (availableWidth <= 0) return; // cell entirely off screen on the left
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fitted = fitText(ctx, label, availableWidth);
    ctx.fillText(fitted, labelX, yTop + height / 2);
  }

  private drawWeekCell(
    ctx: CanvasRenderingContext2D,
    startIdx: number,
    endIdx: number,
    label: string,
    yTop: number,
    height: number
  ): void {
    const v = this.viewport!;
    const cellLeft = v.sidebarWidth + startIdx * v.cellWidth - v.scrollX;
    const cellRight = cellLeft + (endIdx - startIdx + 1) * v.cellWidth;
    // Sticky-centered: the label is centered on the **visible** portion
    // of the cell (clamped between the sidebar and the right edge of the
    // canvas). Without this, the geometric center of the week could
    // be off screen on the left → invisible label.
    const visibleLeft = v.sidebarWidth;
    const visibleRight = v.width;
    const visibleCellLeft = Math.max(cellLeft, visibleLeft);
    const visibleCellRight = Math.min(cellRight, visibleRight);
    if (visibleCellRight <= visibleCellLeft) return;
    const labelX = (visibleCellLeft + visibleCellRight) / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, labelX, yTop + height / 2);
  }

  // ──────────────────────────────────────────────────────────────────
  // Interactive rendering (ghost, drag preview, today line)
  // ──────────────────────────────────────────────────────────────────

  private drawInteractive(): void {
    const v = this.viewport;
    if (!v) return;

    const setup = setupHiDPI(this.interactiveCanvas, v.width, v.height, true);
    if (!setup) return;
    const { ctx, width: w, height: h } = setup;
    ctx.clearRect(0, 0, w, h);

    // Drag preview (semi-transparent ghost bar at the target position).
    // Clipped to the grid area (right of sidebar, below header) so a
    // bar truncated on the left/right does not overflow into the sidebar or
    // the header — otherwise visual glitch during resize/move.
    const drag = this.dragStateRef.current;
    if (drag.active && drag.taskId) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(v.sidebarWidth, v.headerHeight, w - v.sidebarWidth, h - v.headerHeight);
      ctx.clip();
      this.drawDragPreview(ctx, drag);
      ctx.restore();
    }

    // Hover highlight (hovered cell)
    this.drawHoverHighlight(ctx, w, h);
  }

  private drawDragPreview(ctx: CanvasRenderingContext2D, drag: CanvasDragState): void {
    if (!drag.taskId || !this.viewport) return;
    const allocInfo = this.taskIdToAllocated.get(drag.taskId);
    const realTaskId = extractRealTaskId(drag.taskId);
    const task = this.taskIndex.get(realTaskId);
    if (!allocInfo || !task) return;

    // Why: dates FROZEN at pointerdown. The cached `task.startDate/endDate`
    // may already have been updated by mutate.onMutate
    // (microtask) before the pointer hook's 150 ms hold expires
    // → the preview applies deltaDays to the new dates → +1 extra
    // cell during the post-release hold.
    const startDateForPreview = this.dragOriginStartDate ?? task.startDate;
    const endDateForPreview =
      this.dragOriginEndDate ?? task.endDate ?? startDateForPreview;
    // Position in days relative to the 1st visible day (can be negative
    // if the task starts before the period). This value is accepted so
    // the drag preview also shows for truncated tasks: their
    // current position may be out of view, but their target position
    // (after deltaDays) is typically inside the visible window.
    const firstDay = this.daysIso[0];
    if (!firstDay) return;
    const taskStartIdx = differenceInCalendarDays(new Date(startDateForPreview), new Date(firstDay));
    const taskEndIdx = differenceInCalendarDays(new Date(endDateForPreview), new Date(firstDay));

    const v = this.viewport;
    const spanDays = taskEndIdx - taskStartIdx + 1;

    // Compute x / w depending on the mode (move / resize-left / resize-right).
    // Standard logic: the bar keeps its offset relative to the cursor
    // based on where the user clicked. Dragging truncated tasks follows
    // exactly the same rule to stay uniform and predictable.
    let newStartIdx = taskStartIdx;
    let newSpanDays = spanDays;
    if (drag.mode === "move") {
      newStartIdx = taskStartIdx + drag.deltaDays;
    } else if (drag.mode === "resize-left") {
      newStartIdx = taskStartIdx + drag.deltaDays;
      newSpanDays = Math.max(1, spanDays - drag.deltaDays);
    } else if (drag.mode === "resize-right") {
      newSpanDays = Math.max(1, spanDays + drag.deltaDays);
    }

    // Target pixel position (target row if the row changes)
    const targetRowId = drag.mode === "move" ? (drag.targetRowId ?? allocInfo.rowId) : allocInfo.rowId;
    const rowInfo = this.getEffectiveRowInfo(targetRowId);
    if (!rowInfo) return;
    // Pixel-accurate rendered position following the mouse: the drag
    // preview stays attached to the cursor even inside a cell.
    // The business logic (drop on a whole day) stays aligned with the
    // snapped deltaDays via `newStartIdx`, so on release the bar snaps to the
    // grid — "magnetic" behavior but with no perceived offset during
    // the movement. Rounding remainder: we add the exact pixel delta
    // relative to the computed snap.
    const pointerDx = drag.pointerX - drag.originX;
    const snappedDx = drag.deltaDays * v.cellWidth;
    const fluidOffset = pointerDx - snappedDx;
    const xSnapped = v.sidebarWidth + newStartIdx * v.cellWidth - v.scrollX + 4;
    const widthSnapped = Math.max(newSpanDays * v.cellWidth - 8, 12);
    let x = xSnapped;
    let width = widthSnapped;
    if (drag.mode === "move") {
      x = xSnapped + fluidOffset;
    } else if (drag.mode === "resize-right") {
      width = Math.max(widthSnapped + fluidOffset, 12);
    } else if (drag.mode === "resize-left") {
      x = xSnapped + fluidOffset;
      width = Math.max(widthSnapped - fluidOffset, 12);
    }

    // Ghost slot: for a move, simulate the slot the task will
    // occupy in the target row (first free slot, skipping the
    // holidays that overlap the new dates). Without this the
    // preview landed on the SOURCE slot and visually covered the
    // bars already present in the target.
    let ghostSlot = allocInfo.allocated.slot;
    if (drag.mode === "move") {
      const newStartDate = this.daysIso[newStartIdx] ?? task.startDate;
      const newEndIdx = Math.min(
        Math.max(0, newStartIdx + newSpanDays - 1),
        this.daysIso.length - 1
      );
      const newEndDate = this.daysIso[newEndIdx] ?? newStartDate;
      const targetBucket = this.buckets.get(targetRowId) ?? [];
      const realDragId = extractRealTaskId(drag.taskId);
      const dragPrefix = `${realDragId}:`;
      const overlaps = (t: { startDate: string; endDate?: string | null }) =>
        newStartDate <= (t.endDate ?? t.startDate) && newEndDate >= t.startDate;
      const hasHolidayConflict = targetBucket.some(
        (t) => t.id.startsWith("holiday:") && overlaps(t)
      );
      let slot = hasHolidayConflict ? 1 : 0;
      const MAX_SLOT = 50;
      while (slot < MAX_SLOT) {
        const conflict = targetBucket.some(
          (t) =>
            t.id !== drag.taskId &&
            !t.id.startsWith(dragPrefix) &&
            !t.id.startsWith("holiday:") &&
            t.slot === slot &&
            overlaps(t)
        );
        if (!conflict) break;
        slot++;
      }
      ghostSlot = slot;
    }

    const ySnapped =
      v.headerHeight +
      rowInfo.y -
      v.scrollY +
      ghostSlot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) +
      CANVAS_GEOMETRY.rowPadding;
    // Smooth vertical tracking: the drag preview bar follows the mouse
    // pixel by pixel in Y from its original position, independently
    // of the target row. The highlight (drop zone) stays aligned with ySnapped.
    const sourceRowInfo = this.getEffectiveRowInfo(allocInfo.rowId);
    const ySource = sourceRowInfo
      ? v.headerHeight + sourceRowInfo.y - v.scrollY +
        allocInfo.allocated.slot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) +
        CANVAS_GEOMETRY.rowPadding
      : ySnapped;
    const pointerDy = drag.pointerY - drag.originY;
    const y = drag.mode === "move" ? ySource + pointerDy : ySnapped;

    // Target zone highlight: soft, flat highlight (background only,
    // no dotted outline) on the cells where the bar will land.
    // Discreet style so it does not visually compete with the
    // drag preview bar following the cursor.
    const dropX = xSnapped;
    const dropW = widthSnapped;
    const dropH = this.getBarHeight();
    const primary = getCssColor("--primary", "rgba(45,45,50,1)");
    ctx.save();
    ctx.fillStyle = `color-mix(in oklch, ${primary} 12%, transparent)`;
    this.fillRoundedRect(
      ctx,
      dropX - 4,
      ySnapped - CANVAS_GEOMETRY.rowPadding,
      dropW + 8,
      dropH + CANVAS_GEOMETRY.rowPadding * 2,
      4,
    );
    ctx.restore();

    // Box-shadow simulated by a blurred black rect underneath (legacy parity
    // `0 2px 8px rgba(0,0,0,0.18)`).
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    // Redraw the full bar (label, icons, half-day gradient) at the
    // new position. Slightly reduced opacity (legacy DragOverlay parity).
    // Pass truncatedLeft/Right so the text / icons / arrow
    // stay within the visible portion when the bar overflows the period.
    ctx.globalAlpha = 0.85;
    const previewTruncatedLeft = newStartIdx < 0;
    const previewTruncatedRight = newStartIdx + newSpanDays - 1 > v.dayCount - 1;
    this.drawTaskBar(ctx, task, x, y, width, previewTruncatedLeft, previewTruncatedRight);
    ctx.restore();

    // Multi-user resize (users view): also draw a ghost preview
    // on every other occurrence of the same task (other user rows)
    // at the new width — otherwise they stayed frozen at the OLD width
    // during the resize. Consistent with the API, which resizes ALL users.
    if (
      (drag.mode === "resize-left" || drag.mode === "resize-right") &&
      drag.taskId
    ) {
      const realDragId = extractRealTaskId(drag.taskId);
      // Skip if not a user compound (va:/ra: pseudo-tasks or simple ID):
      // no other occurrences to redraw.
      if (realDragId !== drag.taskId) {
      const prefix = `${realDragId}:`;
      for (const [otherId, otherInfo] of this.taskIdToAllocated) {
        if (otherId === drag.taskId) continue; // already drawn above
        if (!otherId.startsWith(prefix)) continue;
        const otherRowInfo = this.getEffectiveRowInfo(otherInfo.rowId);
        if (!otherRowInfo) continue;
        const otherX = v.sidebarWidth + newStartIdx * v.cellWidth - v.scrollX + 4;
        const otherWidth = Math.max(newSpanDays * v.cellWidth - 8, 12);
        const otherY =
          v.headerHeight +
          otherRowInfo.y -
          v.scrollY +
          otherInfo.allocated.slot *
            (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) +
          CANVAS_GEOMETRY.rowPadding;
        ctx.save();
        ctx.globalAlpha = 0.55;
        this.drawTaskBar(ctx, task, otherX, otherY, otherWidth);
        ctx.restore();
      }
      }
    }
  }

  /** Semi-transparent ghost at the drop position while the
   *  Move/Copy menu is open. Skipped during an active drag (the drag
   *  preview is already on screen). */
  private drawPendingDropGhost(ctx: CanvasRenderingContext2D): void {
    if (!this.pendingDropPreview || !this.viewport) return;
    if (this.dragStateRef.current.active) return;
    const v = this.viewport;
    const { taskId, targetRowId, newStartDate, newEndDate } = this.pendingDropPreview;
    const realTaskId = extractRealTaskId(taskId);
    const task = this.taskIndex.get(realTaskId);
    if (!task) return;
    const rowInfo = this.getEffectiveRowInfo(targetRowId);
    if (!rowInfo) return;
    const startIdx = this.daysIso.indexOf(newStartDate);
    if (startIdx < 0) return;
    const endIdx = this.daysIso.indexOf(newEndDate);
    const finalEndIdx = endIdx >= 0 ? endIdx : startIdx;
    const taskLeftPx = startIdx * v.cellWidth;
    const taskWidthPx = (finalEndIdx - startIdx + 1) * v.cellWidth;
    const x = v.sidebarWidth + taskLeftPx - v.scrollX + 4;
    const width = Math.max(taskWidthPx - 8, 12);
    const ghostSlot = this.computeGhostSlotInRow(targetRowId, taskId, newStartDate, newEndDate);
    const y =
      v.headerHeight +
      rowInfo.y -
      v.scrollY +
      ghostSlot * (this.getBarHeight() + CANVAS_GEOMETRY.taskBarGap) +
      CANVAS_GEOMETRY.rowPadding;
    ctx.save();
    ctx.globalAlpha = 0.5;
    this.drawTaskBar(ctx, task, x, y, width);
    ctx.restore();
  }

  private drawHoverHighlight(_ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    // The cell hover is now painted in `drawHoverCellOverlay`
    // during `drawStatic` (behind the bars). Other interactive
    // highlights (drag-target, resize preview, etc.) could be
    // drawn here if needed.
  }

  private drawTodayMarker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.viewport!;
    if (!this.data) return;
    // Thick orange outline around the current day column (header
    // included). 2 vertical lines (left edge / right edge) running
    // from the top of the header to the bottom of the grid — the column stands out
    // without touching the cell backgrounds.
    const todayIdx = this.daysIso.findIndex((d) => isToday(new Date(d)));
    if (todayIdx < 0) return;
    const xLeft = v.sidebarWidth + todayIdx * v.cellWidth - v.scrollX;
    const xRight = xLeft + v.cellWidth;
    if (xRight < v.sidebarWidth || xLeft > w) return;
    ctx.strokeStyle = CANVAS_PALETTE.orange500;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // +0.5 to align on the pixel grid (crisp canvas line).
    ctx.moveTo(Math.round(xLeft) + 0.5, 0);
    ctx.lineTo(Math.round(xLeft) + 0.5, h);
    ctx.moveTo(Math.round(xRight) - 0.5, 0);
    ctx.lineTo(Math.round(xRight) - 0.5, h);
    ctx.stroke();
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  /** Rebuilds the `daysIso` list from the viewport. */
  private refreshDays(): void {
    if (!this.viewport) return;
    const start = this.viewport.gridStart;
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + this.viewport.dayCount - 1);
    this.daysIso = eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));
  }

  /** Computes the label shown on a bar depending on the viewMode. */
  private computeTaskLabel(task: TaskWithUsers): string {
    const untitled = this.i18n.labels.untitled;
    if (!this.data) return task.title || untitled;
    return getTaskLabel(task, this.data.viewMode, untitled);
  }

  /** `roundRect` helpers (Path2D RoundedRect supports iOS Safari 16+). */
  private fillRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    side: "all" | "left" | "right" = "all"
  ): void {
    // Allows rounding only the left corners (rounded-l-sm) or the right ones
    // (rounded-r-sm) — used for the resize handles aligned with the bar.
    let radii: number | [number, number, number, number];
    if (side === "left") {
      radii = [r, 0, 0, r];
    } else if (side === "right") {
      radii = [0, r, r, 0];
    } else {
      radii = r;
    }
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radii);
      ctx.fill();
    } else {
      // Fallback: simplify to a uniform radius
      const rUniform = typeof radii === "number" ? radii : r;
      this.pathRoundedRect(ctx, x, y, w, h, rUniform);
      ctx.fill();
    }
  }

  private strokeRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.stroke();
    } else {
      this.pathRoundedRect(ctx, x, y, w, h, r);
      ctx.stroke();
    }
  }

  private pathRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
