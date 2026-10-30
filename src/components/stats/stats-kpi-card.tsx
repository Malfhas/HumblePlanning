"use client";

import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";

interface StatsKpiCardProps {
  title: string;
  value: string | number;
  suffix?: string;
  icon: React.ReactNode;
  trend?: number;
  className?: string;
}

export function StatsKpiCard({ title, value, suffix, icon, trend, className }: StatsKpiCardProps) {
  const { formatNumber } = useDateFormat();
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{title}</span>
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
      </div>
      <div className="mt-2">
        <span className="text-2xl font-bold">{typeof value === "number" ? formatNumber(value) : value}</span>
        {suffix && <span className="text-sm text-muted-foreground ml-1">{suffix}</span>}
      </div>
      {trend !== undefined && trend !== 0 && (
        <p className={cn("text-xs mt-1", trend > 0 ? "text-emerald-500" : "text-red-500")}>
          {trend > 0 ? "↑" : "↓"} {Math.abs(trend)}%
        </p>
      )}
    </div>
  );
}
