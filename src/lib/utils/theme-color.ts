/**
 * Theme colour of the instance (THEME_COLOR, Settings → Appearance): the accent of the e-mails and of the PDF and
 * Excel exports. The HumblePlanning violet by default. Any colour can be chosen, so the text drawn on it or with it
 * goes through `textOn` and `readableOnWhite`.
 */
export const DEFAULT_THEME_COLOR = "#7c3aed";

export type Rgb = [number, number, number];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const WHITE = "#ffffff";
const INK = "#18181b";

/** The configured colour as "#rrggbb", the default when it is not one. */
export function themeColor(value: string | null | undefined): string {
  const match = HEX_RE.exec(value?.trim() ?? "");
  if (!match) return DEFAULT_THEME_COLOR;
  const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return `#${digits.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(themeColor(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** The colour mixed with white, `amount` (0 → 1) of it kept: a light tint for backgrounds. */
export function tint(hex: string, amount: number): string {
  return rgbToHex(hexToRgb(hex).map((v) => 255 - (255 - v) * amount) as Rgb);
}

/** Relative luminance (WCAG). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two colours (WCAG), from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Text on a background of the colour (a button, a header cell): white while it keeps the contrast of the interface
 * elements (3:1, WCAG), near black on the light colours.
 */
export function textOn(hex: string): string {
  return contrastRatio(hex, WHITE) >= 3 ? WHITE : INK;
}

/** The colour for text on white: itself when readable (4.5:1), else darkened until it is. */
export function readableOnWhite(hex: string): string {
  let rgb = hexToRgb(hex);
  for (let i = 0; i < 30 && contrastRatio(rgbToHex(rgb), WHITE) < 4.5; i++) rgb = rgb.map((v) => v * 0.9) as Rgb;
  return rgbToHex(rgb);
}
