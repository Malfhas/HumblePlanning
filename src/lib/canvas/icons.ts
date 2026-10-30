/**
 * Canvas icons via native `Path2D`.
 *
 * Architectural choice (see agent audit 2026-05-02): native `Path2D` rather
 * than a PNG sprite atlas, because:
 *  - 10 simple icons, manageable as `Path2D`
 *  - 0 async dependency (no image loading)
 *  - Native dynamic colors (`currentColor` via `ctx.fillStyle`)
 *  - Bundle ~2-3 KB minified vs ~6 KB for a PNG atlas
 *  - Trivial maintenance (edit an SVG string)
 *
 * IMPORTANT for SSR: `Path2D` is a DOM API (browser-only). If we
 * instantiate `new Path2D(...)` at module load, Next.js (SSR) crashes with
 * « Path2D is not defined ». So we use a **memoized lazy init**:
 * each icon exposes `getPath(): Path2D | null`, which creates the path on
 * first client-side use and caches it. Server-side it returns
 * `null` (silently; the canvas renderer never runs during SSR).
 *
 * All paths use the `viewBox 0 0 24 24` format (lucide-react). At
 * draw time, we scale to the requested size via `ctx.scale(size/24, size/24)`.
 */

export interface CanvasIcon {
  /** Lazy Path2D getter. Returns `null` server-side. */
  getPath: () => Path2D | null;
  /** Default color. `"currentColor"` = use the ambient `ctx.fillStyle`. */
  defaultColor: string | "currentColor";
  /** Default opacity [0..1]. */
  defaultOpacity: number;
  /** Render mode: fill (solid shapes) or stroke (outlines). */
  mode: "fill" | "stroke";
  /** Stroke width (only when mode === "stroke"). */
  strokeWidth?: number;
}

/** Memoizes the creation of a Path2D from an SVG path data string. */
function memoSvgPath(d: string): () => Path2D | null {
  let cached: Path2D | null | undefined = undefined;
  return () => {
    if (cached !== undefined) return cached;
    if (typeof Path2D === "undefined") {
      // SSR / environment without DOM → return null. The renderer
      // draws nothing (but it does not run during SSR either).
      cached = null;
      return null;
    }
    cached = new Path2D(d);
    return cached;
  };
}

/** Memoizes the creation of a programmatically built Path2D. */
function memoBuilderPath(builder: (p: Path2D) => void): () => Path2D | null {
  let cached: Path2D | null | undefined = undefined;
  return () => {
    if (cached !== undefined) return cached;
    if (typeof Path2D === "undefined") {
      cached = null;
      return null;
    }
    const p = new Path2D();
    builder(p);
    cached = p;
    return cached;
  };
}

// ──────────────────────────────────────────────────────────────────────
// Icon definitions (all paths use the 24×24 viewBox format)
// ──────────────────────────────────────────────────────────────────────

/** Left chevron — clipping indicator when the bar overflows on the left. */
const ICON_CHEVRON_LEFT: CanvasIcon = {
  getPath: memoSvgPath("M15 19L8 12L15 5"),
  defaultColor: "currentColor",
  defaultOpacity: 0.8,
  mode: "stroke",
  strokeWidth: 2.5,
};

/** Right chevron — clipping indicator. */
const ICON_CHEVRON_RIGHT: CanvasIcon = {
  getPath: memoSvgPath("M9 5L16 12L9 19"),
  defaultColor: "currentColor",
  defaultOpacity: 0.8,
  mode: "stroke",
  strokeWidth: 2.5,
};

/** Clock — time range indicator. */
const ICON_CLOCK: CanvasIcon = {
  getPath: memoBuilderPath((p) => {
    p.arc(12, 12, 10, 0, Math.PI * 2);
    p.moveTo(12, 6);
    p.lineTo(12, 12);
    p.lineTo(16, 14);
  }),
  defaultColor: "currentColor",
  defaultOpacity: 0.75,
  mode: "stroke",
  strokeWidth: 2.5,
};

/** Recurrence — marks a child task of a series. */
const ICON_PARENT: CanvasIcon = {
  getPath: memoSvgPath(
    "M17 2 L21 6 L17 10 M3 11 V10 A4 4 0 0 1 7 6 H21 M7 22 L3 18 L7 14 M21 13 V14 A4 4 0 0 1 17 18 H3"
  ),
  defaultColor: "currentColor",
  defaultOpacity: 0.75,
  mode: "stroke",
  strokeWidth: 2.5,
};

/** Paperclip — attachments. */
const ICON_FILE: CanvasIcon = {
  getPath: memoSvgPath(
    "M21.44 11.05L12.25 20.24A6 6 0 0 1 3.76 11.75L12.33 3.18A4 4 0 1 1 18 8.84L9.41 17.41A2 2 0 0 1 6.58 14.58L15.07 6.1"
  ),
  defaultColor: "currentColor",
  defaultOpacity: 0.75,
  mode: "stroke",
  strokeWidth: 2.5,
};

/** Warning triangle — resource/vehicle conflict. Fixed amber color. */
const ICON_CONFLICT: CanvasIcon = {
  getPath: memoSvgPath("M12 2 L1 21 L23 21 Z M11 11 V15 H13 V11 Z M11 17 V19 H13 V17 Z"),
  defaultColor: "#f59e0b",
  defaultOpacity: 1,
  mode: "fill",
};

/** Closed padlock — locked task. */
const ICON_LOCKED: CanvasIcon = {
  getPath: memoBuilderPath((p) => {
    // rect width=18 height=11 x=3 y=11 rx=2 ry=2
    p.moveTo(5, 11);
    p.arcTo(3, 11, 3, 13, 2);
    p.lineTo(3, 20);
    p.arcTo(3, 22, 5, 22, 2);
    p.lineTo(19, 22);
    p.arcTo(21, 22, 21, 20, 2);
    p.lineTo(21, 13);
    p.arcTo(21, 11, 19, 11, 2);
    p.closePath();
    // Shackle: path "M7 11 V7 a5 5 0 0 1 10 0 V11"
    p.moveTo(7, 11);
    p.lineTo(7, 7);
    p.arc(12, 7, 5, Math.PI, 0);
    p.lineTo(17, 11);
  }),
  defaultColor: "currentColor",
  defaultOpacity: 0.8,
  mode: "stroke",
  strokeWidth: 2.5,
};

/** Truck — assigned vehicles. */
const ICON_VEHICLE: CanvasIcon = {
  getPath: memoSvgPath(
    "M14 18V6A2 2 0 0 0 12 4H4A2 2 0 0 0 2 6V17A1 1 0 0 0 3 18H5 M15 18H9 M19 18H21A1 1 0 0 0 22 17V13.35A1 1 0 0 0 21.78 12.726L18.3 8.376A1 1 0 0 0 17.52 8H14V18 M7 16A2 2 0 1 1 7 20A2 2 0 0 1 7 16 M17 16A2 2 0 1 1 17 20A2 2 0 0 1 17 16"
  ),
  defaultColor: "currentColor",
  defaultOpacity: 0.8,
  mode: "stroke",
  strokeWidth: 2,
};

/** Wrench — equipment resources. */
const ICON_RESOURCE: CanvasIcon = {
  getPath: memoSvgPath(
    "M14.7 6.3A1 1 0 0 0 14.7 7.7L16.3 9.3A1 1 0 0 0 17.7 9.3L21.47 5.53A6 6 0 0 1 13.53 13.47L6.62 20.38A2.12 2.12 0 0 1 3.62 17.38L10.53 10.47A6 6 0 0 1 18.47 2.53L14.71 6.29Z"
  ),
  defaultColor: "currentColor",
  defaultOpacity: 0.8,
  mode: "stroke",
  strokeWidth: 2,
};

/** User silhouettes — multi-user bar. */
const ICON_USERS: CanvasIcon = {
  getPath: memoBuilderPath((p) => {
    p.arc(9, 7, 3.5, 0, Math.PI * 2);
    p.moveTo(9, 12);
    p.bezierCurveTo(5, 12, 2, 14, 2, 16.5);
    p.lineTo(2, 18);
    p.lineTo(16, 18);
    p.lineTo(16, 16.5);
    p.bezierCurveTo(16, 14, 13, 12, 9, 12);
    p.closePath();
    p.moveTo(20, 8);
    p.arc(17.5, 8, 2.5, 0, Math.PI * 2);
    p.moveTo(22, 17);
    p.lineTo(22, 16);
    p.bezierCurveTo(22, 14.2, 20.2, 12.7, 17.5, 12.2);
    p.bezierCurveTo(18.4, 13, 19, 14, 19, 15.5);
    p.lineTo(19, 17);
    p.closePath();
  }),
  defaultColor: "currentColor",
  defaultOpacity: 0.75,
  mode: "fill",
};

/** Building2 lucide — Business Unit banner. Several concatenated
 *  sub-paths (main building + stairs + side extensions). */
const ICON_BUILDING2: CanvasIcon = {
  getPath: memoSvgPath(
    "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2 M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2 M10 6h4 M10 10h4 M10 14h4 M10 18h4"
  ),
  defaultColor: "currentColor",
  defaultOpacity: 0.9,
  mode: "stroke",
  strokeWidth: 2,
};

/** UsersRound lucide — Team banner. Different from ICON_USERS (simplified
 *  silhouettes): 2 people with rounded circles, same as the icon
 *  of the sidebar "Teams" menu. */
const ICON_USERS_ROUND: CanvasIcon = {
  getPath: memoBuilderPath((p) => {
    // Main head circle (cx=10, cy=8, r=5)
    p.arc(10, 8, 5, 0, Math.PI * 2);
    p.closePath();
    // Body arc: M18 21 a 8 8 0 0 0 -16 0
    p.moveTo(18, 21);
    p.arc(10, 21, 8, 0, Math.PI, true);
    // Secondary head + body (right arc)
    p.moveTo(22, 20);
    p.bezierCurveTo(22, 16.63, 20, 13.5, 18, 12);
    p.bezierCurveTo(20.4, 8.4, 18.45, 4, 17.55, 3.7);
  }),
  defaultColor: "currentColor",
  defaultOpacity: 0.9,
  mode: "stroke",
  strokeWidth: 2,
};

/** Layers lucide — Project group banner. Three stacked layers (same
 *  icon as the sidebar "Project groups" menu). */
const ICON_LAYERS: CanvasIcon = {
  getPath: memoSvgPath(
    "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12 M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"
  ),
  defaultColor: "currentColor",
  defaultOpacity: 0.9,
  mode: "stroke",
  strokeWidth: 2,
};

/** Icon registry — key = name used in the renderer. */
export const CANVAS_ICONS: Record<string, CanvasIcon> = {
  chevronLeft: ICON_CHEVRON_LEFT,
  chevronRight: ICON_CHEVRON_RIGHT,
  clock: ICON_CLOCK,
  parent: ICON_PARENT,
  file: ICON_FILE,
  conflict: ICON_CONFLICT,
  locked: ICON_LOCKED,
  vehicle: ICON_VEHICLE,
  resource: ICON_RESOURCE,
  users: ICON_USERS,
  building2: ICON_BUILDING2,
  usersRound: ICON_USERS_ROUND,
  layers: ICON_LAYERS,
};

/** Standard icon sizes (see Tailwind h-3, h-3.5). */
export const ICON_SIZE_DEFAULT = 12; // px (h-3 w-3)
export const ICON_SIZE_MEDIUM = 14; // px (h-3.5 w-3.5) — conflict only

/**
 * Draws an icon at the given position and size. If Path2D is not
 * available (SSR), silently returns without drawing anything.
 *
 * @param ctx 2D context
 * @param icon Icon definition (see CANVAS_ICONS)
 * @param x X position of the top-left corner (CSS pixels)
 * @param y Y position of the top-left corner
 * @param size Size of the render square (typically 12 or 14)
 * @param colorOverride When provided, replaces `defaultColor` when it
 *   is `"currentColor"`. If the icon has a fixed color (e.g. #f59e0b
 *   for conflict), the original color is kept.
 */
export function drawCanvasIcon(
  ctx: CanvasRenderingContext2D,
  icon: CanvasIcon,
  x: number,
  y: number,
  size: number = ICON_SIZE_DEFAULT,
  colorOverride?: string
): void {
  const path = icon.getPath();
  if (!path) return; // SSR fallback — silent

  const scale = size / 24;
  const color =
    icon.defaultColor === "currentColor"
      ? colorOverride ?? "#000000"
      : icon.defaultColor;

  ctx.save();
  ctx.globalAlpha = icon.defaultOpacity;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (icon.mode === "fill") {
    ctx.fillStyle = color;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = color;
    // strokeWidth is expressed in the 24×24 viewBox space (parity with the
    // legacy SVG). After `ctx.scale(scale)`, visual thickness = strokeWidth × scale.
    // E.g. strokeWidth=2.5 at size=12 (scale=0.5) → 1.25 px actual — same as SVG.
    ctx.lineWidth = icon.strokeWidth ?? 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
  }
  ctx.restore();
}

/** Visual width of an icon (size + gap for the layout). */
export function getIconLayoutWidth(size: number = ICON_SIZE_DEFAULT, gap = 4): number {
  return size + gap;
}
