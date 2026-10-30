/**
 * Color and dimension tokens for Canvas rendering.
 *
 * Source of truth: the exact values extracted from the React + shadcn DOM
 * (see pixel-perfect audit 2026-05-02). Colors are resolved at
 * runtime from the OKLCH CSS custom properties to follow the
 * light/dark theme, except Tailwind hex values, which are stable.
 *
 * Dimensions and durations are fixed as consts to avoid surprise
 * switches. If the user changes `cellFontSize` or `taskBarHeight` via
 * `usePlanningConfig`, those values override the defaults here.
 */

import type { CanvasViewport } from "./types";

// ──────────────────────────────────────────────────────────────────────
// Geometry constants
// ──────────────────────────────────────────────────────────────────────

export const CANVAS_GEOMETRY = {
  /** Height of a task bar (px). Overridable via app config. */
  taskBarHeight: 24,
  /** Vertical space between 2 bars in a multi-slot row. */
  taskBarGap: 4,
  /** Inner vertical padding of a row (above/below the bars). */
  rowPadding: 4,
  /** Minimum row height (even when maxSlot=0). */
  minRowHeight: 36,
  /** Height of the grouping header (categories, teams). */
  headerRowHeight: 28,
  /** Inner horizontal padding of a bar (px-1.5 = 6 px in Tailwind). */
  barPaddingX: 6,
  /** Horizontal space between bar elements (gap-1 = 4 px). */
  barGapX: 4,
  /** Corner radius of the bars (rounded-sm). */
  barCornerRadius: 2,
  /** Width of the left/right resize handle (w-1.5 = 6 px). */
  resizeHandleWidth: 6,
  /** Horizontal padding between the cell and the bar (px). Must stay
   *  in sync between rendering (renderer.ts) and hit-testing (hit-test.ts)
   *  so the resize handles match their clickable area. */
  cellBarPaddingX: 4,
  /** Height of the month row in the header. */
  headerMonthHeight: 28,
  /** Height of the week row in the header. */
  headerWeekHeight: 22,
  /** Height of the day row in the header (stacked letter + number). */
  headerDayHeight: 38,
  /** Total height of the timeline header (sum of the 3 rows). */
  headerHeight: 88,
  /** Drag activation distance (px) — parity with @dnd-kit. */
  dragActivationDistance: 8,
  /** pointermove throttle for hit-testing (~30 fps). */
  pointerMoveThrottleMs: 32,
  /** Distance before the edge of the loaded area that triggers a prefetch (rolling window). */
  prefetchPadX: 400,
} as const;

// ──────────────────────────────────────────────────────────────────────
// Colors (resolved from Tailwind/shadcn CSS)
// ──────────────────────────────────────────────────────────────────────

/** Fallback palette in hex/rgba. For shadcn tokens (oklch), we
 *  use `getCssColor()` at runtime to follow light/dark. */
export const CANVAS_PALETTE = {
  // Tailwind orange (today / today badge)
  orange50: "#fef3e0",
  orange100: "#fed7aa",
  orange400: "#fb923c",
  orange500: "#f97316",
  orange600: "#ea580c",
  orange950: "#431407",

  // "Today" cell background — orange-400 (#fb923c) at 14 % alpha. Light
  // orange veil that highlights the current day column without hiding the content.
  todayCellBg: "rgba(251, 146, 60, 0.14)",

  // Tailwind amber (conflict)
  amber500: "#f59e0b",

  // Inset bar borders — semi-transparent dark gray so they stay
  // readable on vivid project colors (subtle but crisp border).
  taskBarBorderLight: "rgba(0, 0, 0, 0.35)",
  taskBarBorderDark: "rgba(255, 255, 255, 0.20)",

  // Drag elevation box-shadow
  dragShadow: "rgba(0, 0, 0, 0.18)",

  // Resize handle
  resizeHandle: "rgba(0, 0, 0, 0.35)",

  // White text halo (readability on a colored background)
  textHaloLight: "rgba(255, 255, 255, 0.85)",
  /** Black/white text depending on W3C contrast. */
  textOnLight: "#0f172a",
  textOnDark: "#ffffff",
} as const;

/** Gets the resolved value of a shadcn CSS variable (oklch). Returns
 *  a string usable directly as `fillStyle`. */
export function getCssColor(varName: string, fallback = "#000000"): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

/** Cell background color for the state + current theme. Call
 *  client-side only (reads the DOM via getComputedStyle). */
export function getCellBgColor(state: {
  isWeekend: boolean;
  isToday: boolean;
  conflict: boolean;
  isHighlighted: boolean;
  holidayColor?: string;
}): string {
  // Priority: conflict > highlighted > today > weekend > holiday > default
  if (state.conflict) {
    return "rgba(245, 158, 11, 0.30)"; // amber-500/30
  }
  if (state.isHighlighted) {
    const primary = getCssColor("--primary", "rgba(45, 45, 50, 1)");
    return `color-mix(in oklch, ${primary} 15%, transparent)`;
  }
  if (state.isToday) {
    // In light: orange-50; in dark: orange-950/30
    return CANVAS_PALETTE.todayCellBg;
  }
  if (state.isWeekend) {
    return getCssColor("--muted", "#f5f5f8");
  }
  if (state.holidayColor) {
    const bg = getCssColor("--background", "#ffffff");
    return `color-mix(in oklch, ${state.holidayColor} 8%, ${bg})`;
  }
  return getCssColor("--background", "#ffffff");
}

// ──────────────────────────────────────────────────────────────────────
// Contrast algorithms (W3C luminance)
// ──────────────────────────────────────────────────────────────────────

/** Returns the text color (#000 or #fff) with the best contrast
 *  on a given background. Standard W3C luminance implementation. */
export function getContrastColor(bgHex: string): string {
  const c = bgHex.replace("#", "");
  if (c.length !== 6 && c.length !== 8) return CANVAS_PALETTE.textOnLight;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // W3C relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? CANVAS_PALETTE.textOnLight : CANVAS_PALETTE.textOnDark;
}

/** Color of a bar label. For half days, the span gets a
 *  two-tone gradient (see drawTaskBarLabel); here we only return
 *  the solid fallback for the first paint. */
export function getTaskBarLabelColor(
  bgHex: string,
  timeSlot: "morning" | "afternoon" | "all-day" | "custom"
): string {
  if (timeSlot === "afternoon") return CANVAS_PALETTE.textOnLight;
  if (timeSlot === "morning") return getContrastColor(bgHex);
  return getContrastColor(bgHex);
}

/** Color of a bar's icons depending on timeSlot and bg. */
export function getTaskBarIconColor(
  bgHex: string,
  timeSlot: "morning" | "afternoon" | "all-day" | "custom"
): string {
  if (timeSlot === "afternoon") return CANVAS_PALETTE.textOnLight;
  return getContrastColor(bgHex);
}

/** Increases a color's brightness (CSS equivalent `filter: brightness(1.1)`).
 *  Used for bar hover in the canvas. */
export function brightenColor(hex: string, factor = 1.1): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.min(255, Math.round(parseInt(c.substring(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(c.substring(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(c.substring(4, 6), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Subtle saturation and lightness boost to make bar colors more
 *  vibrant in the canvas render (without touching the DB data).
 *  Minimal effect on already saturated colors (so vivid reds/greens
 *  are not burnt), noticeable on dull / pastel colors. */
export function vibrantizeColor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Saturation: +25 % boost capped at 0.95. The more saturated, the smaller the boost.
  const newS = Math.min(0.95, s + (1 - s) * 0.45);
  // Lightness: if the color is very light (>0.75) or very dark (<0.25),
  // move it slightly toward 0.5 to gain visual intensity.
  let newL = l;
  if (l > 0.75) newL = l - (l - 0.55) * 0.5;
  else if (l < 0.3) newL = l + (0.45 - l) * 0.4;
  const [nr, ng, nb] = hslToRgb(h, newS, newL);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

// ──────────────────────────────────────────────────────────────────────
// Animation durations
// ──────────────────────────────────────────────────────────────────────

export const CANVAS_ANIMATION = {
  /** A new bar appears (optimistic). */
  appearMs: 160,
  /** A deleted bar disappears. */
  deleteMs: 170,
  /** Transition after resize (left/width interpolation). */
  resizeHoldMs: 150,
  /** Cell hover transitions (background-color). */
  hoverMs: 100,
  /** Conflict icon pulse. */
  conflictPulseMs: 2000,
  /** Standard easing cubic-bezier(0.22, 1, 0.36, 1) — equivalent to ease-out-quart. */
  easeOutQuart: (t: number): number => 1 - Math.pow(1 - t, 4),
  /** Easing cubic-bezier(0.4, 0, 0.2, 1) — material default. */
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
} as const;

// ──────────────────────────────────────────────────────────────────────
// Helper viewport
// ──────────────────────────────────────────────────────────────────────

/** Computes the indices of the days visible in the viewport (incl. overscan). */
export function getVisibleDayRange(
  viewport: CanvasViewport,
  overscan = 2
): { firstDayIdx: number; lastDayIdx: number } {
  const visibleLeft = viewport.scrollX;
  const visibleRight = viewport.scrollX + (viewport.width - viewport.sidebarWidth);
  const firstDayIdx = Math.max(0, Math.floor(visibleLeft / viewport.cellWidth) - overscan);
  const lastDayIdx = Math.min(
    viewport.dayCount - 1,
    Math.ceil(visibleRight / viewport.cellWidth) + overscan
  );
  return { firstDayIdx, lastDayIdx };
}
