"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import PhoneInput, { isValidPhoneNumber, getCountryCallingCode } from "react-phone-number-input";
import type { Country } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import frLabels from "react-phone-number-input/locale/fr";
import enLabels from "react-phone-number-input/locale/en";
import esLabels from "react-phone-number-input/locale/es";
import deLabels from "react-phone-number-input/locale/de";
import "react-phone-number-input/style.css";
import type { AppLocale } from "@/i18n/config";

/** Country names (dropdown list, search) in the interface language. */
const COUNTRY_LABELS: Record<AppLocale, typeof frLabels> = { fr: frLabels, en: enLabels, es: esLabels, de: deLabels };
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export { isValidPhoneNumber };

interface CountrySelectOption {
  value: Country | undefined;
  label: string;
  divider?: boolean;
}

interface CountrySelectProps {
  value: Country | undefined;
  onChange: (value: Country | undefined) => void;
  options: CountrySelectOption[];
  disabled?: boolean;
  readOnly?: boolean;
}

function FlagIcon({ country }: { country: Country }) {
  const Flag = flags[country];
  if (!Flag) return null;
  return (
    <span style={{ display: "inline-block", width: "1.25rem", height: "0.9375rem", overflow: "hidden", borderRadius: "2px", lineHeight: 0 }}>
      <Flag title={country} />
    </span>
  );
}

function CountrySelectPopover({ value, onChange, options, disabled, readOnly }: CountrySelectProps) {
  const t = useTranslations("ui.phone");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll the selected country into view when popover opens
  useEffect(() => {
    if (!open) return;
    // Wait for Radix Popover animation to complete
    const timer = setTimeout(() => {
      const btn = selectedRef.current;
      const container = scrollContainerRef.current;
      if (btn && container) {
        const offset = btn.offsetTop - container.clientHeight / 2 + btn.clientHeight / 2;
        container.scrollTop = Math.max(0, offset);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [open]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return options.filter((opt) => {
      if (opt.divider) return false;
      if (!term) return true;
      const label = opt.label.toLowerCase();
      const code = (opt.value || "").toLowerCase();
      return label.includes(term) || code.includes(term);
    });
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || readOnly}
          style={{ background: "none", border: "none", padding: 0, margin: 0, appearance: "none", WebkitAppearance: "none", boxShadow: "none" }}
          className="inline-flex items-center gap-1 cursor-pointer outline-none focus:outline-none focus-visible:outline-none hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {value ? <FlagIcon country={value} /> : <span className="text-base">🌐</span>}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        onWheel={handleWheel}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="p-2 pb-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              name="country-search"
              autoComplete="off"
              placeholder={t("searchCountry")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
          </div>
        </div>
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight: "260px" }}
          onWheel={handleWheel}
        >
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">{t("noCountry")}</p>
          )}
          {filtered.map((opt) => {
            const isSelected = opt.value === value;
            const callingCode = opt.value ? `+${getCountryCallingCode(opt.value)}` : "";
            return (
              <button
                key={opt.value || "intl"}
                ref={isSelected ? selectedRef : undefined}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors",
                  isSelected && "bg-accent"
                )}
              >
                {opt.value ? <FlagIcon country={opt.value} /> : <span className="text-base">🌐</span>}
                <span className="flex-1 truncate">{opt.label}</span>
                {callingCode && <span className="text-xs text-muted-foreground">{callingCode}</span>}
                {isSelected && <Check className="h-3.5 w-3.5 text-violet-600 ml-1" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface PhoneInputCustomProps {
  id?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  defaultCountry?: Country;
  placeholder?: string;
  disabled?: boolean;
}

export function PhoneInputCustom({ id, value, onChange, defaultCountry = "FR", placeholder, disabled }: PhoneInputCustomProps) {
  const locale = useLocale() as AppLocale;
  return (
    <PhoneInput
      id={id}
      labels={COUNTRY_LABELS[locale] ?? frLabels}
      international
      defaultCountry={defaultCountry}
      value={value}
      onChange={onChange as (value?: string) => void}
      placeholder={placeholder}
      disabled={disabled}
      countrySelectComponent={CountrySelectPopover}
      flags={flags}
      className="phone-input-wrapper"
    />
  );
}
