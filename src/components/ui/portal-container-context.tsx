"use client";

import * as React from "react";

/**
 * Context that passes a portal container down to nested dropdowns /
 * popovers. Mainly used by Dialogs: Radix Dialog uses
 * `react-remove-scroll`, which blocks touch events outside its
 * `DialogContent`. By portaling Popovers / Selects / DropdownMenus
 * into this container instead of `document.body`, touch scrolling
 * keeps working on mobile while keeping the benefits of a Portal (no
 * overflow:hidden constraints, clean z-index).
 *
 * `null` (default) → standard Radix behavior, portal into body.
 * `HTMLElement`    → portal into this element (typically DialogContent).
 */
export const PortalContainerContext = React.createContext<HTMLElement | null>(
  null,
);

/** Helper hook for the shadcn UI components (Popover, Select, etc.). */
export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}
