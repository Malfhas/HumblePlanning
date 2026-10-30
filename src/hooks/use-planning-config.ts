"use client";

import { useMemo } from "react";
import { useConfig } from "./use-config";

export interface PlanningConfig {
  taskBarHeight: number;
  taskBarGap: number;
  cellFontSize: number;
  sidebarWidth: "auto" | number;
  sidebarWidthMobileMax: number;
  /** Resolved CSS font family for the canvas (e.g. "Inter, ui-sans-serif, ..."). */
  fontFamily: string;
  /** Bold bar text (weight 600 vs 400 by default). */
  fontBold: boolean;
}

/** Mapping settings key → CSS variable name. All fonts are loaded
 *  through `next/font/google` in `layout.tsx`. The variable holds the generated
 *  internal class name (e.g. `__Inter_xxx`) that must be resolved on the client
 *  because `ctx.font` does not accept `var(...)` — it needs the resolved value. */
const FONT_VAR_BY_KEY: Record<string, string> = {
  geist: "--font-geist-sans",
  inter: "--font-inter",
  roboto: "--font-roboto",
  "ibm-plex-sans": "--font-ibm-plex-sans",
  "source-sans": "--font-source-sans",
};

const FONT_FALLBACK = "ui-sans-serif, system-ui, sans-serif";

/** Resolves a font CSS variable into a value usable by `ctx.font`. */
function resolveFontStack(varName: string): string {
  if (typeof document === "undefined") return FONT_FALLBACK;
  // The variable is attached to the body (through the `inter.variable` className)
  const value = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return value ? `${value}, ${FONT_FALLBACK}` : FONT_FALLBACK;
}

const DEFAULTS: PlanningConfig = {
  taskBarHeight: 24,
  taskBarGap: 4,
  cellFontSize: 11,
  sidebarWidth: "auto",
  sidebarWidthMobileMax: 140,
  fontFamily: FONT_FALLBACK,
  fontBold: false,
};

export function usePlanningConfig(): PlanningConfig {
  const { data: config } = useConfig();

  return useMemo(() => {
    if (!config) return DEFAULTS;
    const taskBarHeight = parseInt(config.PLANNING_LINE_HEIGHT || "24", 10) || 24;
    const cellFontSize = parseInt(config.PLANNING_CELL_FONTSIZE || "11", 10) || 11;

    const rawSidebar = (config.PLANNING_SIDEBAR_WIDTH || "auto").trim().toLowerCase();
    const sidebarWidth: "auto" | number = rawSidebar === "auto"
      ? "auto"
      : (parseInt(rawSidebar, 10) || "auto") as "auto" | number;

    const sidebarWidthMobileMax = parseInt(config.PLANNING_SIDEBAR_WIDTH_MOBILE || "140", 10) || 140;

    const fontKey = (config.PLANNING_FONT_FAMILY || "geist").trim();
    const fontVar = FONT_VAR_BY_KEY[fontKey] || FONT_VAR_BY_KEY.geist;
    const fontFamily = resolveFontStack(fontVar);
    const fontBold = config.PLANNING_FONT_BOLD === "true";

    return { taskBarHeight, taskBarGap: 4, cellFontSize, sidebarWidth, sidebarWidthMobileMax, fontFamily, fontBold };
  }, [config]);
}
