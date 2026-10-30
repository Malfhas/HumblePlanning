"use client";

import { useCallback, useState, cloneElement, isValidElement } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { tDyn, hasDyn } from "@/i18n/dynamic";
import {
  FolderKanban,
  Hash,
  Layers,
  Building2,
  UserRound,
  CalendarClock,
  CircleDot,
  Link as LinkIcon,
  FileText,
} from "lucide-react";

// Project statuses (fixed values): labels planning.tooltips.project.status.<value>
// i18n-dynamic: planning.tooltips.project.status.*

interface ProjectTooltipData {
  name?: string;
  businessNumber?: string | null;
  color?: string | null;
  status?: string | null;
  description?: string | null;
  deliveryDate?: string | null;
  link?: string | null;
  iteration?: string | null;
  owner?: { name?: string | null } | null;
  group?: { name?: string | null; color?: string | null } | null;
  groupName?: string | null;
  groupColor?: string | null;
  businessUnit?: { name?: string | null; number?: string | null; color?: string | null } | null;
  businessUnitName?: string | null;
  businessUnitNumber?: string | null;
  businessUnitColor?: string | null;
}

interface ProjectTooltipProps {
  project: ProjectTooltipData;
  /** "controlled" mode for canvas use — drives visible/pos from
   *  the pixel hit-test (no cloneElement). */
  controlled?: { visible: boolean; pos: { x: number; y: number } };
  children: React.ReactNode;
}

export function ProjectTooltip({ project, controlled, children }: ProjectTooltipProps) {
  const t = useTranslations("planning.tooltips");
  const { formatDate } = useDateFormat();
  const [internalVisible, setInternalVisible] = useState(false);
  const [internalPos, setInternalPos] = useState({ x: 0, y: 0 });
  const visible = controlled ? controlled.visible : internalVisible;
  const pos = controlled ? controlled.pos : internalPos;

  const groupName = project.group?.name || project.groupName;
  const groupColor = project.group?.color || project.groupColor;
  const statusKey = project.status ? `project.status.${project.status}` : null;
  const statusLabel = project.status && statusKey ? (hasDyn(t, statusKey) ? tDyn(t, statusKey) : project.status) : null;

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
                <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" />
                {project.name || t("project.fallbackName")}
              </p>
              {project.businessNumber && (
                <p className="flex items-center gap-1.5">
                  <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                  {project.businessNumber}
                </p>
              )}
              {(() => {
                const buName = project.businessUnit?.name || project.businessUnitName;
                const buNumber = project.businessUnit?.number || project.businessUnitNumber;
                const buColor = project.businessUnit?.color || project.businessUnitColor || "#8b5cf6";
                if (!buName) return null;
                return (
                  <p className="flex items-center gap-1.5">
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: buColor }} />
                    {buNumber ? `${buNumber} · ${buName}` : buName}
                  </p>
                );
              })()}
              {statusLabel && (
                <p className="flex items-center gap-1.5">
                  <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
                  {statusLabel}
                </p>
              )}
              {project.owner?.name && (
                <p className="flex items-center gap-1.5">
                  <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                  {project.owner.name}
                </p>
              )}
              {groupName && (
                <p className="flex items-center gap-1.5">
                  <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: groupColor || "#ccc" }} />
                  {groupName}
                </p>
              )}
              {project.deliveryDate && (
                <p className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                  {formatDate(project.deliveryDate)}
                </p>
              )}
              {project.link && (
                <p className="flex items-center gap-1.5">
                  <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{project.link}</span>
                </p>
              )}
              {project.description && (
                <p className="flex items-start gap-1.5">
                  <FileText className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="line-clamp-2">{project.description}</span>
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
