"use client";

import { useMemo } from "react";
import { HexColorPicker } from "react-colorful";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Paintbrush } from "lucide-react";

// Vibrant palette — saturated Tailwind 500/600. Chosen for readability
// on both dark and light backgrounds, with good separation between adjacent
// hues. Deliberately avoids pastel tones (300/200) that make
// the planning grid look dull.
const PRESET_COLORS = [
  "#dc2626", "#ea580c", "#d97706", "#ca8a04", "#65a30d",
  "#16a34a", "#059669", "#0891b2", "#2563eb", "#4f46e5",
  "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#e11d48",
  "#0d9488", "#0284c7", "#1d4ed8", "#7e22ce", "#be185d", // i18n-ignore colors (false positive)
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Forwarded to the Button trigger so that `<Label htmlFor>` has a target
   *  (avoids the DevTools warning "No label associated with a form field"). */
  id?: string;
}

export function ColorPicker({ value, onChange, id }: ColorPickerProps) {
  const color = useMemo(() => value || "#3b82f6", [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className="w-full justify-start gap-2">
          <div
            className="h-5 w-5 shrink-0 rounded-full border border-input"
            style={{ backgroundColor: color }}
          />
          <span className="flex-1 text-left font-mono text-sm">{color}</span>
          <Paintbrush className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          {/* Visual color picker */}
          <HexColorPicker
            color={color}
            onChange={onChange}
            style={{ width: "100%" }}
          />

          {/* Hex input */}
          <Input
            name="color-hex"
            autoComplete="off"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            maxLength={7}
            placeholder="#3b82f6"
            className="font-mono"
          />

          {/* Preset swatches */}
          <div className="grid grid-cols-10 gap-1.5">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`h-6 w-6 rounded-full border border-input/50 transition-transform hover:scale-110 ${
                  color.toLowerCase() === preset
                    ? "ring-2 ring-offset-2 ring-primary"
                    : ""
                }`}
                style={{ backgroundColor: preset }}
                onClick={() => onChange(preset)}
                title={preset}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
