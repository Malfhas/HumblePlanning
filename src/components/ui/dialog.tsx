"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PortalContainerContext } from "@/components/ui/portal-container-context"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const tA11y = useTranslations("common.a11y")
  // Container ref exposed via PortalContainerContext to child Popovers /
  // Selects / DropdownMenus: they portal into the DialogContent
  // (not body) so `react-remove-scroll` does not block them
  // on mobile.
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  // Combined callback ref: (a) captures the node for PortalContainerContext,
  // (b) blurs the current `activeElement` to avoid the Chrome/Edge warning
  // "Blocked aria-hidden on an element because its descendant retained focus".
  // Radix Dialog sets `aria-hidden="true"` on the portal's siblings when
  // the dialog opens, but the trigger button keeps its focus → a11y
  // conflict. We blur synchronously when DialogContent mounts, BEFORE Radix
  // sets aria-hidden and before it runs its internal focus trap
  // (which `handleOpenAutoFocus` below already neutralizes via preventDefault).
  const refCallback = React.useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
    if (node && typeof document !== "undefined") {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !node.contains(active)) {
        active.blur();
      }
    }
  }, []);

  // UX preference: when a dialog opens, no field should be
  // auto-focused. Otherwise the first `<Input>` ("Title", etc.) grabs
  // the focus and the user gets a blinking cursor they did not
  // ask for. The parent can still force focus by passing its
  // own `onOpenAutoFocus` that does not call preventDefault.
  const handleOpenAutoFocus = (e: Event) => {
    onOpenAutoFocus?.(e);
    if (!e.defaultPrevented) e.preventDefault();
  };

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={refCallback}
        // Same as SheetContent: avoids the Radix warning
        // "Missing `Description` or `aria-describedby={undefined}`" for
        // dialogs that only have a title.
        // Does NOT break the auto-link when `<DialogDescription>` is
        // used: Radix links the Description via its internal
        // context, regardless of this prop.
        aria-describedby={undefined}
        data-slot="dialog-content"
        onOpenAutoFocus={handleOpenAutoFocus}
        className={cn(
          // Mobile: full-screen (the 4 edges of the viewport).
          // grid-cols-[minmax(0,1fr)]: without this constraint, the grid's
          // implicit auto cell stretches to the min-content of the widest
          // child (e.g. a combobox trigger with a long project name).
          // With minmax(0,1fr), the column stays capped at 100% of the
          // container and `w-full` children shrink correctly.
          // content-start: stops the grid from spreading the free
          // vertical space between rows when a `min-h` is set
          // by the consumer (otherwise a big gap between DialogHeader
          // and the first field).
          "fixed top-0 right-0 bottom-0 left-0 z-50 grid grid-cols-[minmax(0,1fr)] content-start w-auto max-w-none max-h-[100dvh] overflow-x-hidden overflow-y-auto gap-4 rounded-none border-0 bg-background p-4 shadow-lg outline-none duration-200",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          // Desktop (≥ sm): centered, max-w-2xl, rounded border/corners.
          // Same as mobile: we keep `grid-cols-[minmax(0,1fr)]` so
          // that `w-full` children shrink inside the grid cell
          // instead of pushing it to their min-content.
          // max-h-[85vh]: on large screens, capped at 85% of the
          // viewport height so the dialog does not visually grow
          // when an inner Collapsible is expanded. Beyond
          // 85vh, the content scrolls inside the dialog (combined
          // with the existing overflow-y-auto), and the dialog itself
          // keeps a stable size.
          "sm:top-1/2 sm:left-1/2 sm:right-auto sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[85vh] sm:rounded-lg sm:border sm:p-6",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      >
        <PortalContainerContext.Provider value={container}>
          {children}
        </PortalContainerContext.Provider>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-sm p-1.5 text-muted-foreground/70 ring-offset-background transition-all duration-200 hover:bg-muted hover:text-foreground hover:rotate-90 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{tA11y("close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      // mb-1: a little extra space (4 px on top of the parent's
      // gap-4) to give the title some room from the first field without
      // creating a large visual gap.
      className={cn("flex flex-col gap-2 text-center sm:text-left mb-1", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const tActions = useTranslations("common.actions")
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{tActions("close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
