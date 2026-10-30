"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { usePortalContainer } from "@/components/ui/portal-container-context"
import { useIsMobile } from "@/hooks/use-is-mobile"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  side,
  sideOffset = 4,
  collisionPadding = 8,
  avoidCollisions,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  // Portal container choice:
  // - Mobile + inside a Dialog: portal into the DialogContent (via
  //   PortalContainerContext). Otherwise `react-remove-scroll` blocks
  //   touch events on everything outside the DialogContent →
  //   the list cannot be scrolled by finger on iOS / Android.
  // - Desktop: portal into `body` (Radix default). The popover then
  //   appears ON TOP of the dialog (higher z-index in the body's
  //   stacking context), as visually expected for ColorPicker,
  //   business unit Combobox, etc. On desktop there is no touch scroll
  //   issue (no blocking react-remove-scroll).
  const portalContainerInDialog = usePortalContainer();
  const isMobile = useIsMobile();
  const portalContainer = isMobile ? portalContainerInDialog : null;

  // UX: opens downward by preference (`side="bottom"`), but we
  // let Radix shift horizontally and flip to top if there is really
  // no room (`avoidCollisions=true`). Without it, a popover too
  // close to an edge (Calendar picker, CellWidthSlider, etc.) would go
  // off screen on mobile. The parent can override with its own
  // `side` / `avoidCollisions` if needed.
  const resolvedSide = side ?? "bottom";
  const resolvedAvoidCollisions = avoidCollisions ?? true;

  // We prevent auto focus on the first focusable element in the
  // popover (typically the `CommandInput` of a search combobox).
  // - On mobile: without this, iOS / Android open the virtual
  //   keyboard right away — annoying when the user just wants
  //   to browse the list.
  // - On desktop: explicit UX preference — auto focus on the
  //   search field feels intrusive, the user wants to see the
  //   list first and tap into the search if needed.
  // The parent can still force focus via its own
  // onOpenAutoFocus by calling it without preventDefault.
  const handleOpenAutoFocus = (e: Event) => {
    onOpenAutoFocus?.(e);
    if (!e.defaultPrevented) e.preventDefault();
  };

  return (
    <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        side={resolvedSide}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        avoidCollisions={resolvedAvoidCollisions}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={cn(
          "z-50 w-[min(18rem,calc(100vw-1rem))] max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain touch-pan-y origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
