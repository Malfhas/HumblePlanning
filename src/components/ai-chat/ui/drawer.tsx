"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Side drawer, for the phone: the sidebar, a detail pane, filters.
 * Slides in from an edge, covers the screen with an overlay, closes with the
 * cross, the overlay or Escape. On a large screen, these contents have their
 * fixed place: the drawer never shows there, the caller decides.
 */
export function Drawer({
  open,
  onOpenChange,
  side = 'left',
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'left' | 'right' | 'bottom';
  /** Accessible title, rendered in the header. */
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("common.a11y");
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ai-chat-portal fixed inset-0 z-50 bg-ai-overlay tiroir-voile" />
        <DialogPrimitive.Content
          className={cn(
            'ai-chat-portal fixed z-50 flex flex-col bg-ai-surface shadow-ai-modal focus:outline-none',
            side === 'left' &&
              'inset-y-0 left-0 w-[85vw] max-w-[320px] border-r border-ai-border-subtle tiroir-gauche',
            side === 'right' &&
              'inset-y-0 right-0 w-[92vw] max-w-[420px] border-l border-ai-border-subtle tiroir-droite',
            side === 'bottom' &&
              'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-ai-xl border-t border-ai-border-subtle pb-[env(safe-area-inset-bottom)] tiroir-bas',
            className,
          )}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-ai-border-subtle px-3">
            <DialogPrimitive.Title className="truncate text-ai-sm font-semibold text-ai-primary">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="grid size-9 place-items-center rounded-ai-md text-ai-muted hover:bg-ai-surface-hover hover:text-ai-primary"
              aria-label={t("close")}
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
