"use client";

import type { HTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cva, type VariantProps } from 'class-variance-authority';
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/* --- Badge --- */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-ai-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-ai-sunken text-ai-secondary border border-ai-border-subtle',
        accent: 'bg-ai-accent-soft text-ai-accent',
        success: 'bg-ai-success-soft text-ai-success',
        warning: 'bg-ai-warning-soft text-ai-warning',
        danger: 'bg-ai-danger-soft text-ai-danger',
        info: 'bg-ai-info-soft text-ai-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* --- Spinner / loading states --- */
export function Spinner({ className }: { className?: string }) {
  const t = useTranslations("common.a11y");
  return (
    <Loader2 className={cn('h-4 w-4 animate-spin text-ai-muted', className)} aria-label={t("loading")} />
  );
}

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

/* --- Tooltip --- */
/**
 * Tooltip. Its content never captures the pointer: a tooltip is read, not
 * clicked, and nothing it covers may become unreachable
 * - on a Gantt or a scheduler, it lands precisely on the handles
 * of the bar it describes.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    // `disableHoverableContent`: the tooltip closes as soon as the pointer leaves its
    // trigger (the provider is the application's, mounted in the layout).
    <TooltipPrimitive.Root disableHoverableContent>
      <TooltipPrimitive.Trigger
        asChild
        // A rich card is enough: the generic truncated-text tooltip stays silent below it
        data-tooltip-rich=""
        /*
          A tooltip also opens on focus, on purpose: with the keyboard, it
          is the only way to know what the button just reached does.
          But a menu or panel that closes returns focus to
          its trigger - the tooltip then showed up on its own, long
          after the click, far from the pointer, and never went away.

          So it opens only on keyboard focus. `preventDefault` is enough:
          Radix composes our handler before its own and gives up its own as soon
          as the event is cancelled.
        */
        onFocus={(event) => {
          if (!event.currentTarget.matches(':focus-visible')) event.preventDefault();
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="ai-chat-portal pointer-events-none z-50 rounded-ai-md border border-ai-border-subtle bg-ai-raised px-2 py-1 text-ai-xs text-ai-primary shadow-ai-overlay"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
