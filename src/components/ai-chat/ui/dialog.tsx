"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  bodyClassName,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Classes of the scrolling body: a working window may want more height. */
  bodyClassName?: string;
  wide?: boolean;
}) {
  const t = useTranslations("common.a11y");
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ai-chat-portal fixed inset-0 z-50 bg-ai-overlay data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        // A click outside does not close the popup: forms in progress must
        // never be lost through an unlucky click (closing with the cross or
        // Escape only).
        onInteractOutside={(event) => event.preventDefault()}
        className={cn(
          'ai-chat-portal fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-ai-lg border-[0.5px] border-ai-border-subtle bg-ai-raised shadow-ai-modal focus:outline-none',
          wide ? 'max-w-3xl' : 'max-w-md',
          // Phone: a sheet docked at the bottom, full width, that never exceeds
          // the screen; the body scrolls, the header and footer stay.
          'max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:flex max-md:max-h-[92dvh] max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:flex-col max-md:rounded-b-none max-md:rounded-t-ai-xl max-md:pb-[env(safe-area-inset-bottom)] max-md:tiroir-bas',
          className,
        )}
      >
        <div className="flex items-start justify-between border-b border-ai-border-subtle px-4 py-3">
          <div>
            <DialogPrimitive.Title className="text-ai-sm font-semibold text-ai-primary">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-ai-xs text-ai-secondary">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="rounded-ai-md p-1 text-ai-muted hover:bg-ai-surface-hover hover:text-ai-primary"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        <div
          className={cn(
            'max-h-[70vh] overflow-y-auto px-4 py-4 max-md:min-h-0 max-md:max-h-none max-md:flex-1',
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-ai-border-subtle px-4 py-3 max-md:flex-wrap">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
