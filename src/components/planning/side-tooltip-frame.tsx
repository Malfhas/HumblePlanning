"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8;
/** The arrow stays inside the rounded corners of the frame. */
const ARROW_INSET = 12;

/** Top of a box of `height` centred on `centerY`, kept inside a window of `viewport` (8 px from its edges). */
export function clampedTop(centerY: number, height: number, viewport: number): number {
  return Math.max(MARGIN, Math.min(centerY - height / 2, viewport - height - MARGIN));
}

/**
 * Frame of the tooltips shown beside a row of the planning (user, project, vehicle): to the right of `x`, centred
 * on `y`, its arrow pointing at `y`. Kept inside the window: near the bottom of the screen it rises instead of being
 * cut, the arrow still on the row. Placed before paint (layout effect), without a visible jump.
 */
export function SideTooltipFrame({ x, y, maxWidth, children }: { x: number; y: number; maxWidth: number; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = frame.current;
    if (!box) return;
    const height = box.offsetHeight;
    const top = clampedTop(y, height, window.innerHeight);
    box.style.top = `${top}px`;
    if (arrow.current) arrow.current.style.top = `${Math.max(ARROW_INSET, Math.min(y - top, height - ARROW_INSET))}px`;
  });

  return createPortal(
    <>
      <style>{`@keyframes tt-slide-right { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: translateX(0); } }`}</style>
      <div
        ref={frame}
        className="z-50 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md border"
        style={{
          position: "fixed",
          left: x,
          top: y,
          maxWidth,
          width: "max-content",
          pointerEvents: "none",
          animation: "tt-slide-right 100ms ease-out",
        }}
      >
        <div
          ref={arrow}
          style={{ position: "absolute", left: -4, top: "50%", marginTop: -4, width: 8, height: 8, background: "inherit", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)", transform: "rotate(45deg)" }}
        />
        {children}
      </div>
    </>,
    document.body,
  );
}
