"use client";

import { formatChartDate } from "./chart-utils";
import { useDateFormat } from "@/hooks/use-date-format";

type ValueKind = "hours" | "percent" | "currency";

/** Entry of the payload Recharts passes to a custom tooltip. */
interface TooltipEntry {
  name?: string | number;
  value?: string | number | readonly (string | number)[];
  color?: string;
  fill?: string;
  payload?: { fill?: string };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string;
  kind?: ValueKind;
  /** ISO currency of `kind="currency"` (default EUR). */
  currency?: string;
}

export function ChartTooltip({ active, payload, label, kind = "hours", currency = "EUR" }: ChartTooltipProps) {
  const { locale, formatNumber } = useDateFormat();
  if (!active || !payload?.length) return null;
  const formattedLabel = label ? formatChartDate(label, locale) : label;
  const formatValue = (v: number) => {
    if (kind === "currency") return formatNumber(v, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: currency === "EUR" ? 2 : 4 });
    return `${formatNumber(v)}${kind === "percent" ? "%" : "h"}`;
  };
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs">
      <p className="font-medium mb-1">{formattedLabel}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill || p.payload?.fill }} />
          {p.name}: <span className="font-semibold">{typeof p.value === "number" ? formatValue(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

type PresetTooltipProps = Omit<ChartTooltipProps, "kind">;

export function HoursTooltip(props: PresetTooltipProps) {
  return <ChartTooltip {...props} kind="hours" />;
}

export function PercentTooltip(props: PresetTooltipProps) {
  return <ChartTooltip {...props} kind="percent" />;
}

export function CurrencyTooltip(props: PresetTooltipProps) {
  return <ChartTooltip {...props} kind="currency" />;
}
