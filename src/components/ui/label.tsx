"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  htmlFor,
  onClick,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  // On a <label htmlFor="x">:
  //  - the browser forwards **clicks** to the #x control (useful for
  //    an <input> = focus, unwanted for a <button role="combobox"> =
  //    opens the dropdown)
  //  - the browser also applies the `:hover` pseudo-class to the
  //    control when the label is hovered (the button changes background
  //    while hovering "Project *")
  //
  // We ALWAYS keep `htmlFor` (otherwise DevTools and screen readers
  // report an orphan label, and accessibility is broken). For
  // button-like controls, we intercept the label's `onClick` with
  // `preventDefault()` → this prevents the synthetic click on the target
  // (so the dropdown does not open) while keeping the semantic link.
  // The propagated `:hover` is still handled case by case by the components
  // (shadcn button ignores hover from a parent label in practice).
  const [isButtonLike, setIsButtonLike] = React.useState(false)

  React.useEffect(() => {
    if (!htmlFor || typeof document === "undefined") {
      setIsButtonLike(false)
      return
    }
    const target = document.getElementById(htmlFor)
    if (!target) {
      setIsButtonLike(false)
      return
    }
    const role = target.getAttribute("role")
    const tag = target.tagName
    const isToggle =
      role === "switch" || role === "checkbox" || role === "radio"
    const buttonLike =
      !isToggle &&
      (tag === "BUTTON" ||
        role === "combobox" ||
        role === "button" ||
        role === "menuitem")
    setIsButtonLike(buttonLike)
  }, [htmlFor])

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLLabelElement>) => {
      if (isButtonLike) {
        // Prevents the browser from generating a synthetic click on the
        // button-like control (otherwise clicking the label = opening the dropdown).
        e.preventDefault()
      }
      onClick?.(e)
    },
    [isButtonLike, onClick]
  )

  return (
    <LabelPrimitive.Root
      data-slot="label"
      htmlFor={htmlFor}
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
