"use client";

import { useState, useCallback, cloneElement, isValidElement } from "react";
import { createPortal } from "react-dom";
import { usePresence, type PresenceUser } from "@/hooks/use-presence";

const MAX_VISIBLE = 3;

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

function PresenceTooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleEnter = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    setVisible(true);
  }, []);

  const handleLeave = useCallback(() => setVisible(false), []);

  const child = isValidElement(children)
    ? cloneElement(children as React.ReactElement<any>, {
        onMouseEnter: (e: React.MouseEvent) => { handleEnter(e); (children as any).props?.onMouseEnter?.(e); },
        onMouseLeave: () => { handleLeave(); (children as any).props?.onMouseLeave?.(); },
      })
    : children;

  return (
    <>
      {child}
      {visible && typeof document !== "undefined" && createPortal(
        <div
          className="z-50 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md border"
          style={{ position: "fixed", left: pos.x, top: pos.y, transform: "translateX(-50%)", pointerEvents: "none", animation: "tt-slide-down 100ms ease-out" }}
        >
          <style>{`@keyframes tt-slide-down { from { opacity: 0; transform: translateX(-50%) translateY(-4px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
          {content}
        </div>,
        document.body
      )}
    </>
  );
}

function PresenceAvatar({ user, index }: { user: PresenceUser; index: number }) {
  const initials = getInitials(user.name);
  const textColor = isLightColor(user.color) ? "#1a1a1a" : "#ffffff";

  return (
    <PresenceTooltip content={<p className="text-xs whitespace-nowrap">{user.name}</p>}>
      <div
        className="presence-avatar relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold select-none cursor-default"
        style={{
          backgroundColor: user.color,
          color: textColor,
          marginLeft: index > 0 ? "-8px" : 0,
          zIndex: MAX_VISIBLE + 2 - index,
          animationDelay: `${index * 80}ms`,
        }}
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initials
        )}
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-green-500" />
      </div>
    </PresenceTooltip>
  );
}

export function PresenceBar() {
  const users = usePresence();

  if (users.length === 0) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length > MAX_VISIBLE ? users.slice(MAX_VISIBLE) : [];

  return (
    <div className="flex items-center">
      {visible.map((user, i) => (
        <PresenceAvatar key={user.userId} user={user} index={i} />
      ))}
      {overflow.length > 0 && (
        <PresenceTooltip
          content={
            <div className="space-y-1.5">
              {overflow.map((u) => (
                <div key={u.userId} className="flex items-center gap-2 text-xs">
                  <div
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold"
                    style={{ backgroundColor: u.color, color: isLightColor(u.color) ? "#1a1a1a" : "#fff" }}
                  >
                    {u.image ? (
                      <img src={u.image} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      getInitials(u.name)
                    )}
                  </div>
                  <span>{u.name}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                </div>
              ))}
            </div>
          }
        >
          <div
            className="presence-avatar relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground select-none cursor-default"
            style={{ marginLeft: "-8px", zIndex: 1, animationDelay: `${MAX_VISIBLE * 80}ms` }}
          >
            +{overflow.length}
          </div>
        </PresenceTooltip>
      )}
    </div>
  );
}
