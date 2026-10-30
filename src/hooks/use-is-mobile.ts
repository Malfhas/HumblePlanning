"use client";

import * as React from "react";

/**
 * Hook that returns `true` when the viewport width is below the
 * mobile breakpoint (640 px = default Tailwind `sm`).
 *
 * Used to adapt the behavior of UI components on mobile:
 * force `side="bottom"` + `avoidCollisions={false}` on Popover /
 * Select / DropdownMenu, disable costly transitions, etc.
 *
 * Initialized to `false` on the server to avoid a hydration mismatch;
 * the real value is set in the `useEffect` on mount.
 */
const MOBILE_BREAKPOINT = 640;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    update();
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}
