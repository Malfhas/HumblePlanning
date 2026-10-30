"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useIsPhone } from "../lib/use-is-phone";

/**
 * Themed context menu (Plane recipe: min-w-[12rem], 11px text,
 * rounded-ai-sm items, translucent hover).
 *
 * On phone: the menu stays on screen (bounded width, collision
 * padding) and its items are a finger tall.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding, ...props }, ref) => {
  const isPhone = useIsPhone();
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding ?? (isPhone ? 8 : undefined)}
        className={cn(
          'ai-chat-portal z-50 min-w-[12rem] rounded-ai-md border-[0.5px] border-ai-border-strong bg-ai-raised p-1.5 text-ai-xs shadow-ai-overlay outline-none max-md:max-w-[calc(100vw-1rem)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-ai-sm px-1.5 py-1.5 outline-none max-md:min-h-10',
      destructive
        ? 'text-ai-danger data-[highlighted]:bg-ai-danger-soft'
        : 'text-ai-secondary data-[highlighted]:bg-ai-surface-hover data-[highlighted]:text-ai-primary',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-ai-border-subtle', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-ai-muted',
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';
