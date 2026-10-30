"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TruncatedCellProps {
  value: string | null | undefined;
  maxWidth?: string;
  className?: string;
  fallback?: string;
  children?: React.ReactNode;
}

/*
 * Responsive mapping: each base maxWidth used in the site is
 * mapped to a string of Tailwind classes that progressively widens
 * the limit on larger screens. The classes must be spelled out
 * in the source file so the Tailwind v4 scanner detects them and
 * generates them in the final CSS (no dynamic concatenation).
 *
 * Scaling logic: ×1 (mobile/tablet) → ×1.6 (lg, 1024+) →
 * ×2.5 (xl, 1280+) → ×3.5 (2xl, 1536+). These ratios give a
 * "responsive to screen space" behavior without hurting the readability
 * of tables on small viewports.
 */
const RESPONSIVE_MAX_WIDTHS: Record<string, string> = {
  "max-w-[100px]": "max-w-[100px] lg:max-w-[160px] xl:max-w-[250px] 2xl:max-w-[350px]",
  "max-w-[120px]": "max-w-[120px] lg:max-w-[200px] xl:max-w-[300px] 2xl:max-w-[420px]",
  "max-w-[140px]": "max-w-[140px] lg:max-w-[230px] xl:max-w-[350px] 2xl:max-w-[500px]",
  "max-w-[150px]": "max-w-[150px] lg:max-w-[240px] xl:max-w-[380px] 2xl:max-w-[530px]",
  "max-w-[160px]": "max-w-[160px] lg:max-w-[260px] xl:max-w-[400px] 2xl:max-w-[560px]",
  "max-w-[180px]": "max-w-[180px] lg:max-w-[290px] xl:max-w-[450px] 2xl:max-w-[630px]",
  "max-w-[200px]": "max-w-[200px] lg:max-w-[320px] xl:max-w-[500px] 2xl:max-w-[700px]",
  "max-w-[220px]": "max-w-[220px] lg:max-w-[350px] xl:max-w-[550px] 2xl:max-w-[770px]",
  "max-w-[240px]": "max-w-[240px] lg:max-w-[380px] xl:max-w-[600px] 2xl:max-w-[840px]",
  "max-w-[260px]": "max-w-[260px] lg:max-w-[420px] xl:max-w-[650px] 2xl:max-w-[910px]",
  "max-w-[280px]": "max-w-[280px] lg:max-w-[450px] xl:max-w-[700px] 2xl:max-w-[980px]",
  "max-w-[300px]": "max-w-[300px] lg:max-w-[480px] xl:max-w-[750px] 2xl:max-w-[1050px]",
  "max-w-[320px]": "max-w-[320px] lg:max-w-[510px] xl:max-w-[800px] 2xl:max-w-[1120px]",
  "max-w-[360px]": "max-w-[360px] lg:max-w-[580px] xl:max-w-[900px] 2xl:max-w-[1260px]",
};

/**
 * Display a text value truncated to a max width with "..." overflow,
 * and show the full text in a tooltip on hover.
 * Falls back to a placeholder (default "—") when value is empty.
 *
 * The given `maxWidth` acts as the **minimum width** on small screens;
 * on large screens (lg/xl/2xl), the allowed width grows
 * automatically to use the available space. See
 * `RESPONSIVE_MAX_WIDTHS`.
 */
export function TruncatedCell({
  value,
  maxWidth = "max-w-[180px]",
  className,
  fallback = "—",
  children,
}: TruncatedCellProps) {
  const hasValue = value != null && value !== "";
  const displayText = hasValue ? value : fallback;

  if (!hasValue) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  const responsiveMaxWidth = RESPONSIVE_MAX_WIDTHS[maxWidth] ?? maxWidth;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("block truncate", responsiveMaxWidth, className)}>
          {children ?? displayText}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">{displayText}</TooltipContent>
    </Tooltip>
  );
}
