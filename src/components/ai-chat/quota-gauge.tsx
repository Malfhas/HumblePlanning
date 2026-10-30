"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import type { tDyn } from "@/i18n/dynamic";
import { shortDate } from "./lib/dates";

/** What the server says about the user's monthly quota: a percentage, never an amount. */
export interface ChatQuota {
  /** False when the quota is disabled or has no amount: no gauge. */
  enabled: boolean;
  unlimited: boolean;
  /** From 0 to 100, integer. */
  percent: number;
  reached: boolean;
  /** Next reset, in ISO. */
  resetsAt: string;
}

export type QuotaColor = 'success' | 'warning' | 'danger';

/** Green up to 69%, orange from 70 to 89%, red from 90%. */
export function quotaColor(percent: number): QuotaColor {
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warning';
  return 'success';
}

/** Translator scoped to `aiChat.quota` (the one from `useTranslations`). */
type QuotaTranslator = Parameters<typeof tDyn>[0];

/** The tooltip text, on two lines; "Unlimited quota" for an exempt account. */
export function quotaText(quota: ChatQuota, t: QuotaTranslator, intlTag: string): string {
  const tr = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  if (quota.unlimited) return tr('unlimited');
  return [tr('used', { percent: quota.percent }), tr('resetOn', { date: shortDate(quota.resetsAt, intlTag) })].join('\n');
}

/**
 * Circular gauge of the monthly quota: a thin ring whose colored arc shows the
 * share used, with no number on it. The detail reads on hover. An account
 * exempt from the quota sees a neutral ring; quota disabled, nothing at all.
 */
export function QuotaGauge({
  quota,
  size = 20,
  className,
}: {
  quota: ChatQuota;
  /** Side of the square, in pixels. */
  size?: number;
  className?: string;
}) {
  const t = useTranslations('aiChat.quota');
  const { intlTag } = useDateFormat();
  if (!quota.enabled) return null;
  const thickness = size >= 20 ? 2.5 : 2;
  const center = size / 2;
  const radius = center - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = (Math.min(100, Math.max(0, quota.percent)) / 100) * circumference;
  const text = quotaText(quota, t, intlTag);
  const full = !quota.unlimited && quota.percent >= 100;

  return (
    <span
      role="img"
      aria-label={text.replace('\n', ' · ')}
      data-tooltip={text}
      data-quota={quota.unlimited ? 'unlimited' : quota.percent}
      className={cn('inline-grid shrink-0 place-items-center', className)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {/* Solid red at 100%: the disc fills, the ring alone no longer says it */}
        {full ? (
          <circle cx={center} cy={center} r={radius} fill="var(--ai-status-danger-soft)" />
        ) : null}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--ai-border-strong)"
          strokeWidth={thickness}
          opacity={0.7}
        />
        {!quota.unlimited && arc > 0 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`var(--ai-status-${quotaColor(quota.percent)})`}
            strokeWidth={thickness}
            strokeLinecap={full ? 'butt' : 'round'}
            strokeDasharray={`${arc} ${circumference}`}
            // The arc starts at noon, like a clock
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
      </svg>
    </span>
  );
}
