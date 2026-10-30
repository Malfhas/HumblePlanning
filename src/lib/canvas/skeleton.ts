/**
 * Skeleton bars for the canvas — visual feedback while a tasks
 * query is being fetched (period change, socket refetch).
 *
 * Style: "shimmer wave" (Notion / Linear / Vercel) — a light gray rect
 * with a white gradient sweeping horizontally in a loop. While the
 * animation runs, the canvas rAF tick redraws, which naturally
 * animates the wave.
 *
 * Usage: called once per "empty" cell (no task in the cache),
 * ideally between `drawGridBackground` and `drawTasks`.
 */

const SKELETON_HEIGHT = 14;
const SKELETON_GAP = 4;
const SKELETON_PADDING_Y = 6;
const SKELETON_PADDING_X = 4;
/** Wave speed: 1 full cycle (0 → cellWidth) in 1.5 s. */
const WAVE_PERIOD_MS = 1500;
/** Width of the "head" of the sweeping white gradient. */
const WAVE_WIDTH = 80;

/** Skeleton bar background color for the theme. */
function getBaseColor(isDark: boolean): string {
  return isDark ? "rgba(80, 85, 100, 0.30)" : "rgba(190, 195, 210, 0.40)";
}

/** Color of the sweeping wave (semi-transparent). */
function getWaveColor(isDark: boolean): string {
  return isDark ? "rgba(180, 185, 200, 0.18)" : "rgba(255, 255, 255, 0.40)";
}

/**
 * Draws a skeleton bar in a cell.
 *
 * @param ctx 2D context
 * @param x   cell left edge
 * @param y   cell top edge
 * @param w   cell width
 * @param h   cell height
 * @param time `performance.now()` or equivalent to animate the wave
 * @param isDark current theme (used for the colors)
 * @param seed pseudo-random offset to desynchronize the bars
 *             across cells (otherwise they all pulse together).
 *             Typically `(rowIndex * 7 + dayIndex * 13) % 1000`.
 */
export function drawSkeletonCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  time: number,
  isDark: boolean,
  seed = 0
): void {
  if (w < 8 || h < SKELETON_HEIGHT + SKELETON_PADDING_Y * 2) return;

  const barWidth = Math.max(w - SKELETON_PADDING_X * 2, 12);
  const barX = x + SKELETON_PADDING_X;
  const barY = y + SKELETON_PADDING_Y;
  const baseColor = getBaseColor(isDark);
  const waveColor = getWaveColor(isDark);

  // Wave position: left-to-right sweep, phase-shifted by seed.
  const phase = ((time + seed * 37) % WAVE_PERIOD_MS) / WAVE_PERIOD_MS;
  // The wave extends 100 px past each side for a clean fade.
  const waveCenter = barX - 100 + phase * (barWidth + 200);

  // Pass 1: solid gray background
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  roundedRectPath(ctx, barX, barY, barWidth, SKELETON_HEIGHT, 3);
  ctx.fill();

  // Pass 2: wave gradient overlaid (clipped to the rect)
  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, barX, barY, barWidth, SKELETON_HEIGHT, 3);
  ctx.clip();
  const grad = ctx.createLinearGradient(
    waveCenter - WAVE_WIDTH,
    0,
    waveCenter + WAVE_WIDTH,
    0
  );
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, waveColor);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, barWidth, SKELETON_HEIGHT);
  ctx.restore();
}

/** Internal helper: rounded path (no fill/stroke so it can be clipped). */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const SKELETON_GEOMETRY = {
  height: SKELETON_HEIGHT,
  gap: SKELETON_GAP,
  paddingY: SKELETON_PADDING_Y,
  paddingX: SKELETON_PADDING_X,
} as const;
