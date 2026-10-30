"use client";

import { useCallback, useLayoutEffect, useRef, useState, cloneElement, isValidElement } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { StickyNote, AlertTriangle, Truck, Wrench, CalendarDays, Clock, FolderKanban, Building2, Users, CircleDot, UserPen, Pencil, MapPin } from "lucide-react";

const RESIZE_EDGE_PX = 6;

interface TaskTooltipProps {
  task: {
    title?: string | null;
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
    hasConflict?: boolean;
    conflictType?: "vehicle" | "resource";
    vehicleNames?: string[];
    resourceNames?: string[];
    users?: { name?: string | null; firstName?: string | null; businessUnitId?: string | null; businessUnit?: { name?: string | null; number?: string | null; color?: string | null } | null }[];
    createdAt?: string | null;
    creator?: { name?: string | null; firstName?: string | null } | null;
    updatedAt?: string | null;
    lastModifier?: { name?: string | null; firstName?: string | null } | null;
  };
  project?: {
    name: string;
    color?: string | null;
    businessNumber?: string | null;
    businessUnitId?: string | null;
    businessUnit?: { name?: string | null; number?: string | null; color?: string | null } | null;
  } | null;
  status?: { name: string } | null;
  user?: { name: string } | null;
  viewMode?: string;
  forceHidden?: boolean;
  /** "controlled" mode (for the canvas — the bar is not a DOM node,
   *  so mouse events cannot be attached to an element.
   *  The parent computes `visible` and the position itself from
   *  a pixel hit-test and passes them through this prop). */
  controlled?: {
    visible: boolean;
    anchor: { x: number; top: number; bottom: number };
  };
  children: React.ReactNode;
}

export function TaskTooltip({ task, project, status, viewMode, forceHidden, controlled, children }: TaskTooltipProps) {
  const t = useTranslations("planning.tooltips");
  const { formatDate, formatDateTime, formatTime } = useDateFormat();
  const [internalVisible, setInternalVisible] = useState(false);
  // anchor = task bar rect + cursor x. Both vertical edges are kept
  // so the tooltip can flip above when it would overflow.
  const [internalAnchor, setInternalAnchor] = useState({ x: 0, top: 0, bottom: 0 });
  const visible = controlled ? controlled.visible : internalVisible;
  const anchor = controlled ? controlled.anchor : internalAnchor;
  const setVisible = setInternalVisible;
  const setAnchor = setInternalAnchor;
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const onEdgeRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (forceHidden) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isOnEdge = x < RESIZE_EDGE_PX || x > rect.width - RESIZE_EDGE_PX;
    onEdgeRef.current = isOnEdge;
    if (!isOnEdge) {
      setAnchor({ x: e.clientX, top: rect.top, bottom: rect.bottom });
      setVisible(true);
    }
  }, [forceHidden]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (forceHidden) { setVisible(false); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isOnEdge = x < RESIZE_EDGE_PX || x > rect.width - RESIZE_EDGE_PX;

    if (isOnEdge && !onEdgeRef.current) {
      onEdgeRef.current = true;
      setVisible(false);
    } else if (!isOnEdge && onEdgeRef.current) {
      onEdgeRef.current = false;
      setAnchor({ x: e.clientX, top: rect.top, bottom: rect.bottom });
      setVisible(true);
    } else if (!isOnEdge) {
      // Follow cursor horizontally, keep vertical anchored to bar
      setAnchor({ x: e.clientX, top: rect.top, bottom: rect.bottom });
    }
  }, [forceHidden]);

  const handleMouseLeave = useCallback(() => {
    onEdgeRef.current = false;
    setVisible(false);
  }, []);

  // Flip above when there is no room below. useLayoutEffect avoids
  // a one-frame flash at the wrong position (synchronous measure before paint).
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const h = tooltipRef.current.offsetHeight;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const spaceAbove = anchor.top;
    if (spaceBelow < h + 12 && spaceAbove > h + 12) {
      setPlacement("top");
    } else {
      setPlacement("bottom");
    }
  }, [visible, anchor]);

  const showModifier = (task.lastModifier?.name || task.lastModifier?.firstName) && task.updatedAt && task.createdAt &&
    task.updatedAt !== task.createdAt;

  // Clone child to inject mouse handlers — except in controlled mode, where the
  // parent drives visible/anchor manually (canvas case).
  const child = !controlled && isValidElement(children)
    ? cloneElement(children as React.ReactElement<any>, {
        onMouseEnter: (e: React.MouseEvent) => {
          handleMouseEnter(e);
          (children as any).props?.onMouseEnter?.(e);
        },
        onMouseMove: (e: React.MouseEvent) => {
          handleMouseMove(e);
          (children as any).props?.onMouseMove?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          handleMouseLeave();
          (children as any).props?.onMouseLeave?.(e);
        },
      })
    : children;

  return (
    <>
      {child}
      {visible && !forceHidden && typeof document !== "undefined" && createPortal(
          <div
            ref={tooltipRef}
            className="z-50 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md border"
            style={{
              position: "fixed",
              left: anchor.x,
              // bottom placement: top anchored to the bar + 8px
              // top placement: bottom anchored to the top of the bar + 8px
              //   (window.innerHeight - anchor.top as CSS bottom = distance to the viewport bottom)
              ...(placement === "bottom"
                ? { top: anchor.bottom + 8 }
                : { bottom: window.innerHeight - anchor.top + 8 }),
              transform: "translateX(-50%)",
              maxWidth: 360,
              pointerEvents: "none",
            }}
          >
          {/* Arrow: above for bottom placement, below for top placement */}
          <div
            style={{
              position: "absolute",
              ...(placement === "bottom" ? { top: -4 } : { bottom: -4 }),
              left: "50%",
              marginLeft: -4,
              width: 8,
              height: 8,
              background: "inherit",
              borderLeft: placement === "bottom" ? "1px solid var(--border)" : undefined,
              borderTop: placement === "bottom" ? "1px solid var(--border)" : undefined,
              borderRight: placement === "top" ? "1px solid var(--border)" : undefined,
              borderBottom: placement === "top" ? "1px solid var(--border)" : undefined,
              transform: "rotate(45deg)",
            }}
          />
          <div className="space-y-1.5 text-xs">
            {task.hasConflict && (
              <p className="flex items-center gap-1.5 font-semibold text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0" />
                {task.conflictType === "resource"
                  ? t("task.resourceConflict")
                  : t("task.vehicleConflict")}
              </p>
            )}
            <p className="font-semibold text-sm">{task.title || t("untitled")}</p>
            <p className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
              {formatDate(task.startDate)}
              {task.endDate && task.endDate !== task.startDate && (
                <> → {formatDate(task.endDate)}</>
              )}
            </p>
            {task.startTime && (
              <p className="flex items-center gap-1.5">
                <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                {formatTime(task.startTime)}
                {task.endTime && <> – {formatTime(task.endTime)}</>}
              </p>
            )}
            {project && (
              <p className="flex items-center gap-1.5">
                <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color || "#ccc" }}
                />
                {project.businessNumber ? `[${project.businessNumber}] ` : ""}{project.name}
              </p>
            )}
            {(() => {
              // In "projects" view, the task bar represents a user → show user BU
              // In other views (users, places, etc.), the bar represents a project → show project BU
              if (viewMode === "projects") {
                const userBus = new Map<string, { name?: string | null; number?: string | null; color?: string | null }>();
                for (const u of task.users ?? []) {
                  if (u.businessUnit?.name && !userBus.has(u.businessUnit.name)) {
                    userBus.set(u.businessUnit.name, u.businessUnit);
                  }
                }
                if (userBus.size === 0) return null;
                return [...userBus.values()].map((ub, i) => (
                  <p key={i} className="flex items-center gap-1.5">
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: ub.color || "#8b5cf6" }} />
                    {ub.number ? `${ub.number} · ${ub.name}` : ub.name}
                  </p>
                ));
              }
              const bu = project?.businessUnit;
              if (!bu?.name) return null;
              return (
                <p className="flex items-center gap-1.5">
                  <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: bu.color || "#8b5cf6" }} />
                  {bu.number ? `${bu.number} · ${bu.name}` : bu.name}
                </p>
              );
            })()}
            {task.users && task.users.length > 1 && (
              <p className="flex items-center gap-1.5">
                <Users className="size-3.5 shrink-0 text-muted-foreground" />
                {task.users.map((u: any) => u.name).join(", ")}
              </p>
            )}
            {status && (
              <p className="flex items-center gap-1.5">
                <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
                {status.name}
              </p>
            )}
            {task.vehicleNames && task.vehicleNames.length > 0 && (
              <p className="flex items-center gap-1.5">
                <Truck className="size-3.5 shrink-0 text-muted-foreground" />
                {task.vehicleNames.join(", ")}
              </p>
            )}
            {task.resourceNames && task.resourceNames.length > 0 && (
              <p className="flex items-center gap-1.5">
                <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                {task.resourceNames.join(", ")}
              </p>
            )}
            {task.notes && (
              <p className="flex items-start gap-1.5 line-clamp-3">
                <StickyNote className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                <span>{task.notes}</span>
              </p>
            )}
            {task.creator?.name && task.createdAt && (
              <div className="border-t border-border/50 mt-2 pt-1.5" />
            )}
            {task.creator?.name && task.createdAt && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <UserPen className="size-3.5 shrink-0" />
                {task.creator.name} — {formatDateTime(task.createdAt)}
              </p>
            )}
            {showModifier && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Pencil className="size-3.5 shrink-0" />
                {task.lastModifier!.name} — {formatDateTime(task.updatedAt)}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
