"use client";

import { useSocket } from "@/hooks/use-socket";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * LiveStatusBadge — small Socket.io status indicator in the schedule
 * toolbar.
 *
 *  - Connected: pulsing green dot + "Live" — discreet, reassuring.
 *    The tooltip explains that changes made by other users
 *    appear in real time without a manual refresh.
 *
 *  - Disconnected: steady red dot + "Offline" — visible without
 *    being alarming. The tooltip explains that the schedule keeps
 *    refreshing every 2 min while waiting for the reconnection.
 *
 * The component waits ~1.5 s before showing the "disconnected" state to
 * avoid flashing on the very first render (the socket has not had time
 * to complete its handshake yet).
 */
export function LiveStatusBadge() {
  const t = useTranslations("planning.liveStatus");
  const { connected, enabled } = useSocket();
  const [showOffline, setShowOffline] = useState(false);

  // Delay before showing "Offline" to avoid flashing
  // on mount (Socket.io handshake ~500-1500 ms).
  useEffect(() => {
    if (connected) {
      setShowOffline(false);
      return;
    }
    const timer = window.setTimeout(() => setShowOffline(true), 1500);
    return () => window.clearTimeout(timer);
  }, [connected]);

  if (!enabled) return null;

  if (connected) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 select-none"
            role="status"
            aria-label={t("live.ariaLabel")}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {t("live.label")}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          {t("live.tooltip")}
        </TooltipContent>
      </Tooltip>
    );
  }

  // "Disconnected" state — shown only after the delay.
  if (!showOffline) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400 select-none"
          role="status"
          aria-label={t("offline.ariaLabel")}
        >
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          {t("offline.label")}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[280px]">
        {t("offline.tooltip")}
      </TooltipContent>
    </Tooltip>
  );
}
