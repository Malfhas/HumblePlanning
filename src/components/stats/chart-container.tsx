"use client";

import { ResponsiveContainer } from "recharts";
import { useChartFullscreen } from "./chart-card";

interface ChartContainerProps {
  children: React.ReactNode;
  height?: number;
  minHeight?: number;
}

/**
 * Wrapper around Recharts ResponsiveContainer that adapts to fullscreen mode.
 * In normal mode: uses the provided height (or minHeight).
 * In fullscreen mode: fills 100% of available space.
 */
export function ChartContainer({ children, height = 300, minHeight }: ChartContainerProps) {
  const isFullscreen = useChartFullscreen();

  if (isFullscreen) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={minHeight ? Math.max(minHeight, height) : height}>
      {children as any}
    </ResponsiveContainer>
  );
}
