"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const CYCLE: Record<string, string> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/** Labels: keys of `common.theme`. */
const LABEL_KEYS = {
  light: "light",
  dark: "dark",
  system: "system",
} as const;

export function ThemeToggle({
  className,
  tooltipSide = "bottom",
}: {
  className?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
} = {}) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const t = useTranslations("common.theme");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="ghost" size="icon" className={cn("size-9", className)} disabled />;
  }

  const current = theme ?? "system";
  const next = CYCLE[current] ?? "light";
  const label = t(LABEL_KEYS[current as keyof typeof LABEL_KEYS] ?? "system");

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-9", className)}
            onClick={() => setTheme(next)}
            aria-label={label}
          >
            {current === "system" ? (
              <Monitor className="h-4 w-4" />
            ) : resolvedTheme === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
