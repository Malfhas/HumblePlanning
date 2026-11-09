"use client";

import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Trash2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeleteShortcutHint as Hint } from "@/hooks/use-delete-shortcut";

/** Key to press again, as printed on the keyboard. */
const macKeyboard = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Hint of the delete key: the task outlined in red and, above it, « press Delete again to delete »
 * (or « insufficient permission »). Never catches the mouse.
 */
export function DeleteShortcutHint({ hint }: { hint: Hint | null }) {
  const t = useTranslations("planning.grid.deleteShortcut");
  if (!hint || typeof document === "undefined") return null;
  const confirm = hint.kind === "confirm";
  const { rect } = hint;
  // Above the task when there is room, else under it; centred on the cursor, kept in the window
  const top = rect ? rect.top : hint.y;
  const bottom = rect ? rect.top + rect.height : hint.y;
  const above = top > 44;
  const x = Math.min(Math.max(hint.x, 120), window.innerWidth - 120);

  return createPortal(
    <>
      {rect && (
        <div
          aria-hidden
          className={cn("pointer-events-none fixed z-[60] rounded-[5px] ring-2 ring-offset-1 ring-offset-background", confirm ? "ring-destructive" : "ring-muted-foreground/60")}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      )}
      <div
        role="status"
        className={cn(
          "pointer-events-none fixed z-[60] flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md",
          confirm ? "bg-destructive text-white" : "border bg-popover text-popover-foreground",
        )}
        style={{ left: x, ...(above ? { bottom: window.innerHeight - top + 6 } : { top: bottom + 6 }) }}
      >
        {confirm ? <Trash2 className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
        {confirm ? t("confirm", { key: macKeyboard() ? "⌫" : t("key") }) : t("denied")}
      </div>
    </>,
    document.body,
  );
}
