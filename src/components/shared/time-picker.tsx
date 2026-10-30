"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Clock, X } from "lucide-react";
import { useDateFormat } from "@/hooks/use-date-format";

interface TimePickerProps {
  value?: string; // "HH:MM" or ""
  onChange: (value: string) => void;
  placeholder?: string;
  minuteStep?: number; // 5, 10, 15, 30 — default 30
  /** Forwarded to the Button trigger. Needed so that `<FormLabel htmlFor>`
   *  has a real target (otherwise DevTools warns "Incorrect use of
   *  <label for=FORM_ELEMENT>" when the component is wrapped by a
   *  shadcn `<FormControl>` that injects the id via Slot). */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TimePicker({
  value,
  onChange,
  placeholder: placeholderProp,
  minuteStep = 30,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: TimePickerProps) {
  const t = useTranslations("ui.timePicker");
  const tCommon = useTranslations("common.actions");
  const { formatTime: formatTimeUtil, formatHourLabel } = useDateFormat();
  const placeholder = placeholderProp ?? tCommon("select");
  const [open, setOpen] = useState(false);

  const parsed = useMemo(() => {
    if (!value) return null;
    const parts = value.split(":");
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || "0", 10);
    if (isNaN(h)) return null;
    return { hour: h, minute: isNaN(m) ? 0 : m };
  }, [value]);

  const [selectedHour, setSelectedHour] = useState<number | null>(parsed?.hour ?? null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  // Sync when value changes externally
  useEffect(() => {
    if (parsed) setSelectedHour(parsed.hour);
  }, [parsed]);

  const minutes = useMemo(() => {
    const result: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) result.push(m);
    return result;
  }, [minuteStep]);

  const handleHourClick = useCallback((h: number) => {
    setSelectedHour(h);
    // If current value already has this hour, keep minutes; otherwise default to :00
    const currentMin = parsed?.hour === h ? parsed.minute : 0;
    onChange(`${String(h).padStart(2, "0")}:${String(currentMin).padStart(2, "0")}`);
  }, [onChange, parsed]);

  const handleMinuteClick = useCallback((m: number) => {
    const h = selectedHour ?? 0;
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    setOpen(false);
  }, [onChange, selectedHour]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSelectedHour(null);
  }, [onChange]);

  const label = parsed
    ? formatTimeUtil(`${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`)
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-9 gap-2",
            !value && "text-muted-foreground"
          )}
        >
          <Clock className="h-4 w-4 shrink-0" />
          <span className="flex-1">{label}</span>
          {value && (
            <span
              role="button"
              className="shrink-0 rounded-sm hover:bg-accent p-0.5"
              onClick={handleClear}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <div className="flex divide-x" style={{ height: 220 }}>
          {/* Hours column */}
          <div className="flex-1 overflow-y-auto p-1">
            <div className="text-[10px] font-medium text-muted-foreground text-center mb-1">{t("hour")}</div>
            <div className="grid grid-cols-4 gap-0.5">
              {HOURS.map((h) => (
                <Button
                  key={h}
                  type="button"
                  variant={selectedHour === h ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs px-0"
                  onClick={() => handleHourClick(h)}
                >
                  {formatHourLabel(h)}
                </Button>
              ))}
            </div>
          </div>

          {/* Minutes column */}
          <div className="w-[72px] overflow-y-auto p-1" ref={minuteListRef}>
            <div className="text-[10px] font-medium text-muted-foreground text-center mb-1">{t("minutes")}</div>
            <div className="flex flex-col gap-0.5">
              {minutes.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={parsed?.minute === m && parsed?.hour === selectedHour ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  disabled={selectedHour === null}
                  onClick={() => handleMinuteClick(m)}
                >
                  :{String(m).padStart(2, "0")}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
