"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useAiChatAvailability } from "@/hooks/use-ai-chat-availability";
import { useConfig } from "@/hooks/use-config";
import { fontVariableOf } from "@/hooks/use-planning-config";
import { useAssistantStore } from "./assistant-store";
import { FloatingAssistant } from "./floating-assistant";
import { useReplyListener } from "./replies-store";
import { GlobalTooltip } from "./ui/global-tooltip";

/**
 * AI chat root, mounted once in the application layout: the
 * floating sphere, the listener for replies finishing in the background, the toasts
 * and the chat tooltip. When unavailable to the user (chat disabled, not
 * configured, no model or no permission), nothing is rendered or loaded.
 */
export function AiChatRoot() {
  const { data } = useAiChatAvailability();
  if (!data?.available) return null;
  return <AvailableChat sphereAllowed={data.widget.visible} />;
}

function AvailableChat({ sphereAllowed }: { sphereAllowed: boolean }) {
  useReplyListener();
  const { resolvedTheme } = useTheme();
  /**
   * The chat writes in the font chosen in the settings, like the planning. Set on
   * <body>, where the font variables live: the page, the sphere and what they portal
   * all inherit it (ai-chat.css).
   */
  const { data: config } = useConfig();
  const fontKey = config?.PLANNING_FONT_FAMILY;
  useEffect(() => {
    document.body.style.setProperty("--ai-font", `var(${fontVariableOf(fontKey)})`);
    return () => {
      document.body.style.removeProperty("--ai-font");
    };
  }, [fontKey]);
  return (
    <div className="ai-chat-root" data-ai-chat>
      {sphereAllowed ? <FloatingAssistant /> : null}
      <Toasts theme={resolvedTheme === "dark" ? "dark" : "light"} />
      <GlobalTooltip />
    </div>
  );
}

/** Plane-style toasts: 350 px card at the bottom right, raised background, colored dot. */
function Toasts({ theme }: { theme: "light" | "dark" }) {
  // The assistant sphere occupies the corner: toasts rise above it
  const sphere = useAssistantStore((state) => state.sphereVisible);
  const t = useTranslations("common.a11y");
  return (
    <Toaster
      position="bottom-right"
      gap={8}
      theme={theme}
      // A cross on each message: a warning toast waits eight seconds,
      // it must be dismissable without waiting (placed top right by ai-chat.css)
      closeButton
      offset={sphere ? { bottom: 92 } : undefined}
      // Phone (sonner switches there below 600 px): above the sphere and the safe area
      mobileOffset={{ bottom: `calc(${sphere ? 92 : 16}px + env(safe-area-inset-bottom))` }}
      toastOptions={{
        closeButtonAriaLabel: t("close"),
        className:
          "ai-chat-portal !w-[350px] max-md:!w-[min(350px,calc(100vw-2rem))] !rounded-ai-lg !border-[0.5px] !border-[var(--ai-border-subtle)] !bg-[var(--ai-bg-raised)] !text-[var(--ai-text-primary)] !shadow-[var(--ai-shadow-overlay)]",
        descriptionClassName: "!text-[var(--ai-text-muted)]",
      }}
    />
  );
}
