"use client";

import { createPortal } from "react-dom";
import { Building2 } from "lucide-react";

interface SidebarRowTooltipProps {
  /** Row whose info is displayed (user, project, place, resource…). */
  row: {
    name: string;
    businessUnitName?: string | null;
    businessUnitColor?: string | null;
    color?: string | null;
  };
  /** Anchor in screen coords (clientX/Y) — provided by useCanvasTooltip. */
  anchor: { x: number; top: number; bottom: number };
}

/**
 * Simple tooltip shown when hovering a row in the canvas sidebar
 * (user, project, etc.). Rendered in a portal to `document.body`,
 * bottom positioning by default (above the cursor).
 */
export function SidebarRowTooltip({ row, anchor }: SidebarRowTooltipProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="z-50 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md border"
      style={{
        position: "fixed",
        left: anchor.x,
        top: anchor.bottom + 8,
        transform: "translateX(-50%)",
        maxWidth: 240,
        pointerEvents: "none",
      }}
    >
      <div className="space-y-1 text-xs">
        <p className="font-semibold text-sm">{row.name}</p>
        {row.businessUnitName && (
          <p className="flex items-center gap-1.5">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: row.businessUnitColor || "#8b5cf6" }}
            />
            {row.businessUnitName}
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
