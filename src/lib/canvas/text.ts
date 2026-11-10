/**
 * Text helpers for Canvas rendering.
 *
 * Key optimizations:
 *  1. `fitText` cache: truncation is computed once per
 *     `(text, font, maxWidth)` and reused as long as these keys do not
 *     change.
 *  2. Length pre-estimate via the average character width
 *     (`avgCharWidth`) — avoids N `measureText` calls when looking for
 *     the right place to cut. Medium article: -76 % on truncation
 *     time.
 *  3. White halo + fill: two passes for readability on a colored
 *     background. `lineJoin: "round"` avoids ugly corners.
 *
 * The cache is bounded by `MAX_CACHE_SIZE` (FIFO eviction) so it does not
 * blow up on very varied datasets. With ~30,000 tasks × ~10
 * distinct widths (cellWidth varies with zoom), there are < 300,000
 * entries in the worst case — the limit keeps memory usage
 * bounded.
 */

const MAX_CACHE_SIZE = 50_000;

const fitTextCache = new Map<string, string>();
const avgCharWidthCache = new Map<string, number>();

/**
 * Truncates `text` so it fits in `maxWidth` pixels with the given
 * `font`. Appends "…" when truncated. Stable and idempotent.
 *
 * @param ctx 2D context (used for `measureText`)
 * @param text Source text to truncate
 * @param maxWidth Maximum width in pixels
 * @returns Truncated text (with a trailing "…" when needed)
 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (!text) return "";
  if (maxWidth <= 0) return "";

  const cacheKey = `${ctx.font}|${maxWidth}|${text}`;
  const cached = fitTextCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: string;
  // Optimization: if the whole text fits, return it directly
  if (ctx.measureText(text).width <= maxWidth) {
    result = text;
  } else {
    // Quick estimate via the average width, then refine
    const avg = getAvgCharWidth(ctx, ctx.font);
    const ellipsisWidth = ctx.measureText("…").width;
    const estimated = Math.max(0, Math.floor((maxWidth - ellipsisWidth) / avg));
    let end = Math.min(estimated + 2, text.length);
    while (end > 0 && ctx.measureText(text.slice(0, end) + "…").width > maxWidth) {
      end -= 1;
    }
    result = end > 0 ? text.slice(0, end) + "…" : "";
  }

  // FIFO eviction
  if (fitTextCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fitTextCache.keys().next().value;
    if (firstKey !== undefined) fitTextCache.delete(firstKey);
  }
  fitTextCache.set(cacheKey, result);
  return result;
}

/** Average character width for the given `font`. Measured only
 *  once per font (cache). */
function getAvgCharWidth(ctx: CanvasRenderingContext2D, font: string): number {
  const cached = avgCharWidthCache.get(font);
  if (cached !== undefined) return cached;
  const sample = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789";
  const width = ctx.measureText(sample).width / sample.length;
  avgCharWidthCache.set(font, width);
  return width;
}

/**
 * Draws text with a white halo (stroke) + black/colored fill.
 * Guarantees readability on any background.
 *
 * Pattern:
 *  - `ctx.lineWidth = 3` (halo thickness, tunable)
 *  - `ctx.lineJoin = "round"` (avoids ugly corners)
 *  - `ctx.strokeText` (semi-opaque white halo)
 *  - `ctx.fillText` (dark text on top)
 *
 * @param ctx 2D context (font and textBaseline must already be set)
 * @param text Text to draw
 * @param x X position (CSS pixels)
 * @param y Y position (CSS pixels) — depends on textBaseline
 * @param fillColor Fill color (e.g. "#0f172a")
 * @param haloColor Halo color (default: semi-opaque white)
 * @param haloWidth Halo thickness in px (default: 3)
 */
export function drawHaloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fillColor: string,
  haloColor = "rgba(255, 255, 255, 0.85)",
  haloWidth = 3
): void {
  if (!text) return;
  // Halo (stroke)
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = haloColor;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  // Fill on top
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

/**
 * Clears the caches. Useful during Turbopack hot reload or unit tests.
 * In production, the caches stay in memory for the lifetime of the tab.
 */
export function clearTextCaches(): void {
  fitTextCache.clear();
  avgCharWidthCache.clear();
}

/**
 * Initials on a coloured disc of `diameter` centred on (cx, cy), in the current font, the box of their glyphs at the
 * centre of the disc.
 *
 * The "middle" baseline and "center" alignment use the metrics of the font, which put initials a little off-centre,
 * differently on each system: the glyphs themselves are measured. And the text rasterisers put the baseline on a
 * whole device pixel (Windows at density 1 in particular): drawn at a fractional height, the letters fell up to a
 * pixel low in a 20 px disc. So the baseline is placed on a whole device pixel and the disc follows it vertically -
 * a shift of less than half a pixel, invisible in its row. Not horizontally: the discs of a column must stay
 * aligned from one row to the next (a disc moved by half a pixel according to the width of its letters showed).
 */
export function fillInitialsDisc(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  diameter: number,
  discColor: string,
  textColor: string,
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const dx = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  // Baseline on a whole device pixel, through the current transform (density, scroll)
  const t = ctx.getTransform();
  const y = (Math.round(t.d * (cy + dy) + t.f) - t.f) / t.d;
  ctx.fillStyle = discColor;
  ctx.beginPath();
  ctx.arc(cx, y - dy, diameter / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, cx + dx, y);
}
