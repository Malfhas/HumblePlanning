"use client";

import { useCallback, useState, cloneElement, isValidElement } from "react";
import { createPortal } from "react-dom";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { contrastColor } from "@/lib/utils";
import { Truck, Hash, MessageSquare, CircleDot } from "lucide-react";
import { useTranslations } from "next-intl";
import { tDyn, hasDyn } from "@/i18n/dynamic";

// Vehicle statuses (fixed values): labels planning.tooltips.vehicle.status.<value>
// i18n-dynamic: planning.tooltips.vehicle.status.*

const STATUS_COLORS: Record<string, string> = {
  available: "#22c55e",
  maintenance: "#f59e0b",
  out_of_service: "#ef4444",
};

interface VehicleTooltipData {
  name?: string;
  registrationNumber?: string | null;
  status?: string;
  color?: string | null;
  comment?: string | null;
  vehicleType?: {
    id: string;
    name: string;
    icon: string;
    color: string;
  } | null;
}

interface VehicleTooltipProps {
  vehicle: VehicleTooltipData;
  /** "controlled" mode for canvas use — drives visible/pos from
   *  the pixel hit-test (no cloneElement). */
  controlled?: { visible: boolean; pos: { x: number; y: number } };
  children: React.ReactNode;
}

export function VehicleTooltip({ vehicle, controlled, children }: VehicleTooltipProps) {
  const t = useTranslations("planning.tooltips");
  const [internalVisible, setInternalVisible] = useState(false);
  const [internalPos, setInternalPos] = useState({ x: 0, y: 0 });
  const visible = controlled ? controlled.visible : internalVisible;
  const pos = controlled ? controlled.pos : internalPos;

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setInternalPos({ x: rect.right + 8, y: rect.top + rect.height / 2 });
    setInternalVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setInternalVisible(false);
  }, []);

  const child = !controlled && isValidElement(children)
    ? cloneElement(children as React.ReactElement<any>, {
        onMouseEnter: (e: React.MouseEvent) => { handleMouseEnter(e); (children as any).props?.onMouseEnter?.(e); },
        onMouseLeave: (e: React.MouseEvent) => { handleMouseLeave(); (children as any).props?.onMouseLeave?.(e); },
      })
    : children;

  return (
    <>
      {child}
      {visible && typeof document !== "undefined" && createPortal(
        <>
          <style>{`@keyframes tt-slide-right { from { opacity: 0; transform: translateY(-50%) translateX(-4px); } to { opacity: 1; transform: translateY(-50%) translateX(0); } }`}</style>
          <div
            className="z-50 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md border"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: "translateY(-50%)",
              maxWidth: 280,
              pointerEvents: "none",
              animation: "tt-slide-right 100ms ease-out",
            }}
          >
            <div style={{ position: "absolute", left: -4, top: "50%", marginTop: -4, width: 8, height: 8, background: "inherit", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)", transform: "rotate(45deg)" }} />
            <div className="space-y-1.5 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-sm">
                <Truck className="size-3.5 shrink-0 text-muted-foreground" />
                {vehicle.name || t("vehicle.fallbackName")}
              </p>
              {vehicle.vehicleType && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: vehicle.vehicleType.color, color: contrastColor(vehicle.vehicleType.color) }}
                  >
                    <QualificationIcon name={vehicle.vehicleType.icon} className="size-2.5" />
                    {vehicle.vehicleType.name}
                  </span>
                </div>
              )}
              {vehicle.registrationNumber && (
                <p className="flex items-center gap-1.5">
                  <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                  {vehicle.registrationNumber}
                </p>
              )}
              {vehicle.status && (
                <p className="flex items-center gap-1.5">
                  <CircleDot className="size-3.5 shrink-0" style={{ color: STATUS_COLORS[vehicle.status] }} />
                  {hasDyn(t, `vehicle.status.${vehicle.status}`) ? tDyn(t, `vehicle.status.${vehicle.status}`) : vehicle.status}
                </p>
              )}
              {vehicle.comment && (
                <p className="flex items-start gap-1.5">
                  <MessageSquare className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="line-clamp-3">{vehicle.comment}</span>
                </p>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
