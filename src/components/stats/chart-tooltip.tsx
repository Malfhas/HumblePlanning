"use client";

import { formatChartDate } from "./chart-utils";
import { useDateFormat } from "@/hooks/use-date-format";

type ValueKind = "hours" | "percent" | "currency";

interface ChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  kind?: ValueKind;
}

export function ChartTooltip({ active, payload, label, kind = "hours" }: ChartTooltipProps) {
  const { locale, formatNumber } = useDateFormat();
  if (!active || !payload?.length) return null;
  const formattedLabel = label ? formatChartDate(label, locale) : label;
  const formatValue = (v: number) => {
    if (kind === "currency") return formatNumber(v, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return `${formatNumber(v)}${kind === "percent" ? "%" : "h"}`;
  };
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs">
      <p className="font-medium mb-1">{formattedLabel}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill || p.payload?.fill }} />
          {p.name}: <span className="font-semibold">{typeof p.value === "number" ? formatValue(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function HoursTooltip(props: any) {
  return <ChartTooltip {...props} kind="hours" />;
}

export function PercentTooltip(props: any) {
  return <ChartTooltip {...props} kind="percent" />;
}

export function CurrencyTooltip(props: any) {
  return <ChartTooltip {...props} kind="currency" />;
}
