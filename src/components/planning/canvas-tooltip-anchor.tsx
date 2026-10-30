"use client";

import { forwardRef } from "react";

/**
 * 1×1 px ghost div, positioned dynamically when hovering a canvas
 * bar (direct `style.transform` mutation in `useCanvasTooltip`).
 *
 * Serves as the `<TooltipTrigger asChild>` anchor for the controlled Radix Tooltip.
 * `pointer-events: none` because the events stay captured by the canvas
 * underneath.
 */
export const CanvasTooltipAnchor = forwardRef<HTMLDivElement, { className?: string }>(
  function CanvasTooltipAnchor({ className }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden
        className={className}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
    );
  }
);
