"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useConfig } from "@/hooks/use-config";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

export function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("layout.footer");
  const { data: config } = useConfig();

  const showPrivacy = config?.FOOTER_SHOW_PRIVACY_LINK !== "false" && config?.PRIVACY_POLICY_ENABLED === "true";
  const showVersion = config?.FOOTER_SHOW_VERSION !== "false";
  const copyright = config?.FOOTER_COPYRIGHT_TEXT;

  if (!showPrivacy && !showVersion && !copyright) return null;

  return (
    <div className={cn("border-t border-border/50 px-3 py-2 space-y-1", collapsed && "px-1 py-1.5")}>
      {showPrivacy && (
        collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/privacy"
                target="_blank"
                aria-label={t("privacy")}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
              >
                <Shield className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{t("privacy")}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/privacy"
            target="_blank"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Shield className="size-3 shrink-0" />
            {t("privacy")}
          </Link>
        )
      )}
      {!collapsed && copyright && (
        <p className="text-[10px] text-muted-foreground/70 truncate">{copyright}</p>
      )}
      {showVersion && (
        <p className={cn("text-[10px] text-muted-foreground/50", collapsed && "text-center")}>
          v{APP_VERSION}
        </p>
      )}
    </div>
  );
}
