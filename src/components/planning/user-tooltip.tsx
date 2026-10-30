"use client";

import { useCallback, useRef, useState, cloneElement, isValidElement } from "react";
import { createPortal } from "react-dom";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { contrastColor } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { User, Briefcase, UsersRound, Building2, Mail, Phone, Award, LogIn } from "lucide-react";

interface UserTooltipData {
  name?: string;
  firstName?: string | null;
  displayName?: string;
  email?: string | null;
  job?: string | null;
  phone?: string | null;
  mobile?: string | null;
  color?: string | null;
  teamName?: string | null;
  teamColor?: string | null;
  businessUnitName?: string | null;
  businessUnitNumber?: string | null;
  businessUnitColor?: string | null;
  lastLoginAt?: string | null;
  qualifications?: { id: string; name: string; emoji: string; color: string }[];
}

interface UserTooltipProps {
  user: UserTooltipData;
  /** "controlled" mode for canvas use — drives visible/pos from the pixel hit-test. */
  controlled?: { visible: boolean; pos: { x: number; y: number } };
  children: React.ReactNode;
}

export function UserTooltip({ user, controlled, children }: UserTooltipProps) {
  const t = useTranslations("planning.tooltips");
  const { formatDateTime } = useDateFormat();
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
              maxWidth: 360,
              width: "max-content",
              pointerEvents: "none",
              animation: "tt-slide-right 100ms ease-out",
            }}
          >
            {/* Left arrow */}
            <div style={{ position: "absolute", left: -4, top: "50%", marginTop: -4, width: 8, height: 8, background: "inherit", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)", transform: "rotate(45deg)" }} />
            <div className="space-y-1.5 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-sm">
                <User className="size-3.5 shrink-0 text-muted-foreground" />
                {user.displayName || user.name || t("user.fallbackName")}
              </p>
              {user.job && (
                <p className="flex items-center gap-1.5">
                  <Briefcase className="size-3.5 shrink-0 text-muted-foreground" />
                  {user.job}
                </p>
              )}
              {user.businessUnitName && (
                <p className="flex items-center gap-1.5">
                  <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: user.businessUnitColor || "#8b5cf6" }} />
                  {user.businessUnitNumber ? `${user.businessUnitNumber} · ${user.businessUnitName}` : user.businessUnitName}
                </p>
              )}
              {user.teamName && (
                <p className="flex items-center gap-1.5">
                  <UsersRound className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: user.teamColor || "#ccc" }} />
                  {user.teamName}
                </p>
              )}
              {user.email && (
                <p className="flex items-center gap-1.5 min-w-0">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{user.email}</span>
                </p>
              )}
              {(user.phone || user.mobile) && (
                <p className="flex items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  {user.phone || user.mobile}
                </p>
              )}
              {user.qualifications && user.qualifications.length > 0 && (
                <div className="flex items-start gap-1.5 pt-0.5">
                  <Award className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1">
                    {user.qualifications.map((q) => (
                      <span key={q.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: q.color, color: contrastColor(q.color) }}>
                        <QualificationIcon name={q.emoji} className="size-2.5" />
                        {q.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {user.lastLoginAt && (
                <>
                  <div className="border-t border-border/50 mt-2 pt-1.5" />
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <LogIn className="size-3.5 shrink-0" />
                    {formatDateTime(user.lastLoginAt)}
                  </p>
                </>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
