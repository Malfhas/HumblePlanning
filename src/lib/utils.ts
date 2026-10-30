import type React from "react";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import type { TaskTimeSlot } from "./utils/time-slots";

/**
 * The AI chat tokens (`ai-chat.css`) are outside the Tailwind scale: if not
 * declared, tailwind-merge treats `text-ai-xs` as a color and drops the
 * actual text color (e.g. `text-ai-on-accent` on buttons).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ai-xs", "ai-sm"],
      radius: ["ai-xs", "ai-sm", "ai-md", "ai-lg", "ai-xl"],
      shadow: ["ai-raised", "ai-overlay", "ai-modal"],
      font: ["ai-mono"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns "#000000" or "#ffffff" for optimal contrast on the given background hex color. */
export function contrastColor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // W3C relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

/**
 * Fallback text color for the label of a half-day bar.
 * The two-color gradient (background-clip: text) is applied via
 * `useLayoutEffect` in the component to align the transition precisely
 * with the left/right split of the bar. This function only avoids a
 * flash of invisible text while the DOM measurement happens.
 */
export function taskBarLabelFallbackColor(bgHex: string, timeSlot: TaskTimeSlot): string | undefined {
  if (timeSlot === "afternoon") return "#000000";
  if (timeSlot === "morning") return contrastColor(bgHex);
  return undefined;
}

/**
 * Color to apply to the icons (SVG `currentColor`) of a task bar.
 * Icons are left-aligned, so:
 *   - morning  → colored left area → contrast of the background color
 *   - afternoon → white left area → always black
 *   - all-day / custom → contrast of the background color
 */
export function taskBarIconColor(bgHex: string, timeSlot: TaskTimeSlot): string {
  if (timeSlot === "afternoon") return "#000000";
  return contrastColor(bgHex);
}

/** @deprecated replaced by `taskBarLabelFallbackColor` + `taskBarIconColor`. */
export function taskBarReadabilityStyle(bgHex: string, timeSlot: TaskTimeSlot): React.CSSProperties | undefined {
  const color = taskBarLabelFallbackColor(bgHex, timeSlot);
  return color ? { color } : undefined;
}

/** Format project display name: "[Number] Name" or just "Name" if no number. */
export function formatProjectName(project: { name: string; businessNumber?: string | null }): string {
  return project.businessNumber ? `[${project.businessNumber}] ${project.name}` : project.name;
}
