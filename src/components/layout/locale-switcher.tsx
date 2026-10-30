"use client";

import { useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type LocalePreference } from "@/i18n/config";
import { useAutoLocale } from "@/i18n/intl-client-provider";

// The cookie only changes through this component, followed by a reload: no subscription.
const subscribeNoop = () => () => {};

/** Browser preference: HP_LOCALE cookie, missing = "Automatic". */
function readPreference(): LocalePreference {
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`).exec(document.cookie)?.[1];
  return (LOCALES as readonly string[]).includes(match ?? "") ? (match as LocalePreference) : "auto";
}

/**
 * Language picker: Automatic / Français / English.
 * Sets (or removes) the cookie via `POST /api/locale`, then reloads the page:
 * `<html lang>`, third-party widgets, canvas and caches restart in the right language.
 */
export function LocaleSwitcher({
  className,
  tooltipSide = "bottom",
  align = "end",
}: {
  className?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
} = {}) {
  const t = useTranslations("common.locale");
  const locale = useLocale();
  const autoLocale = useAutoLocale();
  // Client cookie: null on server render and during hydration, then the real value
  // (useSyncExternalStore): no hydration mismatch.
  const preference = useSyncExternalStore<LocalePreference | null>(subscribeNoop, readPreference, () => null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(next: LocalePreference) {
    if (pending || next === preference) return;
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      window.location.reload();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  const options: { value: LocalePreference; label: string }[] = [
    { value: "auto", label: autoLocale ? t("autoWithLanguage", { language: LOCALE_NAMES[autoLocale] }) : t("auto") },
    ...LOCALES.map((l) => ({ value: l as LocalePreference, label: LOCALE_NAMES[l] })),
  ];

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("relative size-9", className)}
                aria-label={t("label")}
                data-testid="locale-switcher"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded-sm bg-muted px-0.5 text-[8px] font-semibold uppercase leading-tight text-muted-foreground">
                  {locale}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>{t("label")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align={align} className="min-w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            lang={option.value === "auto" ? undefined : option.value}
            onSelect={(event) => {
              event.preventDefault();
              void choose(option.value);
            }}
            data-testid={`locale-option-${option.value}`}
          >
            <Check className={cn("h-4 w-4", preference === option.value ? "opacity-100" : "opacity-0")} />
            {option.label}
          </DropdownMenuItem>
        ))}
        {failed && (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            {t("changeError")}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
