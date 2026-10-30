"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useConfig } from "@/hooks/use-config";
import { X } from "lucide-react";
import { ICON_MAP } from "@/components/shared/icon-picker";
import { contrastColor } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/utils/sanitize-html";

export function AnnouncementBanner() {
  const tA11y = useTranslations("common.a11y");
  const { data: config } = useConfig();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  const enabled = config?.ANNOUNCEMENT_ENABLED === "true";
  const content = config?.ANNOUNCEMENT_CONTENT || "";
  const expiresAt = config?.ANNOUNCEMENT_EXPIRES_AT || "";
  const version = config?.ANNOUNCEMENT_VERSION || "0";
  const color = config?.ANNOUNCEMENT_COLOR || "#3b82f6";
  const iconName = config?.ANNOUNCEMENT_ICON || "Megaphone";
  const repeat = config?.ANNOUNCEMENT_REPEAT || "never";

  const IconComponent = ICON_MAP[iconName] || ICON_MAP.Megaphone;
  const textColor = contrastColor(color);

  useEffect(() => {
    if (!enabled || !content) {
      setVisible(false);
      return;
    }

    // Check expiry
    if (expiresAt) {
      const expiry = new Date(expiresAt.replace(" ", "T"));
      if (!isNaN(expiry.getTime()) && expiry < new Date()) {
        setVisible(false);
        return;
      }
    }

    // Check if already dismissed
    const dismissedData = localStorage.getItem("announcement_dismissed");
    if (dismissedData) {
      try {
        const { ver, at } = JSON.parse(dismissedData);
        // If version changed (admin re-saved), always show
        if (ver === version) {
          if (repeat === "never") {
            setVisible(false);
            return;
          }
          // Check if repeat period has elapsed
          const dismissedAt = new Date(at).getTime();
          const now = Date.now();
          const intervals: Record<string, number> = {
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
          };
          const interval = intervals[repeat];
          if (interval && now - dismissedAt < interval) {
            setVisible(false);
            return;
          }
        }
      } catch {
        // Invalid data, show the banner
      }
    }

    setDismissed(false);
    setVisible(true);
  }, [enabled, content, expiresAt, version, repeat]);

  function handleDismiss() {
    localStorage.setItem("announcement_dismissed", JSON.stringify({ ver: version, at: new Date().toISOString() }));
    setDismissed(true);
    setTimeout(() => setVisible(false), 300);
  }

  if (!visible) return null;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl transition-all duration-300 ${
        dismissed
          ? "opacity-0 -translate-y-6 scale-95"
          : "opacity-100 translate-y-0 scale-100"
      }`}
    >
      <div
        className="rounded-xl shadow-2xl backdrop-blur-sm border border-white/20"
        style={{ backgroundColor: `${color}e6` }}
      >
        <div className="px-4 py-2.5 flex items-center gap-4">
          <IconComponent className="h-4 w-4 shrink-0" style={{ color: textColor }} />

          <div
            className="flex-1 min-w-0 text-[13px] leading-snug [&_a]:underline [&_a]:font-semibold [&_p]:inline [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
            style={{ color: textColor }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
          />

          <button
            onClick={handleDismiss}
            className="shrink-0 rounded-lg p-1 transition-colors"
            style={{ color: `${textColor}b3` }}
            onMouseEnter={(e) => { e.currentTarget.style.color = textColor; e.currentTarget.style.backgroundColor = `${textColor === "#FFFFFF" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = `${textColor}b3`; e.currentTarget.style.backgroundColor = "transparent"; }}
            title={tA11y("close")}
            aria-label={tA11y("close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
