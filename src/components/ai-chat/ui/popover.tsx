"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useIsPhone } from "../lib/use-is-phone";

/**
 * Themed popover (Plane panel recipe: thin border, light shadow,
 * raised background). Base of the pickers (Select, DatePicker, properties).
 *
 * `modal` by default: opened above a (modal) Dialog, a portaled popover
 * leaves the subtree allowed by the dialog scroll lock
 * (react-remove-scroll) - the mouse wheel would otherwise be inert there.
 *
 * On phone, a panel never overflows the screen nor touches its edge:
 * bounded width, and a collision padding that Radix applies by shifting it.
 */
export const Popover = (props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) => (
  <PopoverPrimitive.Root modal {...props} />
);
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 4, collisionPadding, ...props }, ref) => {
  const isPhone = useIsPhone();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding ?? (isPhone ? 8 : undefined)}
        className={cn(
          'ai-chat-portal z-50 rounded-ai-md border-[0.5px] border-ai-border-strong bg-ai-raised shadow-ai-overlay outline-none max-md:max-w-[calc(100vw-1rem)]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = 'PopoverContent';
