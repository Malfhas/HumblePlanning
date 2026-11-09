"use client";

import { useEffect, useRef, useState } from "react";
import { DELETE_CONFIRM_MS, isDeleteKey, pressDelete, type ArmedDelete } from "@/lib/utils/delete-shortcut";

/** Box of a task on screen (client coordinates). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Task under the cursor, as the view resolves it. */
export interface DeleteShortcutTarget {
  /** Identity of the task (and of its row when it matters), passed back to `onConfirm`. */
  key: string;
  /** Its box, outlined while the deletion waits; null when the view cannot tell it. */
  rect: ScreenRect | null;
  /** Same rule as the « Delete » item of the context menu. */
  canDelete: boolean;
  /** The menu opens a dialog for this task (`deleteOpensDialog`): the first press opens it. */
  opensDialog: boolean;
}

/** Part of `rect` inside `bounds` (a bar that goes on past the visible grid), null when nothing is left. */
export function clipRect(rect: ScreenRect, bounds: { left: number; top: number; right: number; bottom: number }): ScreenRect | null {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.left + rect.width, bounds.right);
  const bottom = Math.min(rect.top + rect.height, bounds.bottom);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export interface DeleteShortcutHint {
  kind: "confirm" | "denied";
  rect: ScreenRect | null;
  /** Cursor, where the hint goes when the box is unknown. */
  x: number;
  y: number;
}

/** How long the « insufficient permission » hint stays. */
const DENIED_MS = 1500;

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Typing somewhere, or a dialog, menu or popup open: the delete key is not for a task. */
function keyBelongsElsewhere(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  return !!document.querySelector(
    "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]",
  );
}

/**
 * Delete key on the task under the cursor, as the « Delete » item of the context menu: when a dialog follows
 * (shared or recurring task), the first press opens it through `onConfirm`; otherwise a first press shows a
 * hint and outlines the task, and a second press within the delay of the menu deletes it through `onConfirm`.
 * The wait ends without deleting when the delay is over, the cursor leaves the task, on Escape, on scroll.
 * While the hint shows, `data-delete-shortcut` on the body hides the task tooltip under it.
 */
export function useDeleteShortcut({ enabled, resolve, onConfirm }: {
  enabled: boolean;
  resolve: (clientX: number, clientY: number) => DeleteShortcutTarget | null;
  onConfirm: (key: string) => void;
}): DeleteShortcutHint | null {
  const [hint, setHint] = useState<DeleteShortcutHint | null>(null);
  const resolveRef = useRef(resolve);
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    resolveRef.current = resolve;
    confirmRef.current = onConfirm;
  });

  useEffect(() => {
    if (!enabled) return;
    let pos: { x: number; y: number } | null = null;
    let armed: ArmedDelete | null = null;
    let shownKey: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
      clearTimeout(timer);
      armed = null;
      shownKey = null;
      setHint(null);
    };
    const show = (next: DeleteShortcutHint, key: string, ms: number) => {
      clearTimeout(timer);
      shownKey = key;
      setHint(next);
      timer = setTimeout(clear, ms);
    };

    const onMove = (e: MouseEvent) => {
      pos = { x: e.clientX, y: e.clientY };
      // The cursor left the task: the wait is over
      if (shownKey && resolveRef.current(e.clientX, e.clientY)?.key !== shownKey) clear();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (shownKey) clear();
        return;
      }
      if (!isDeleteKey(e, isMac()) || !pos || keyBelongsElsewhere(e.target)) return;
      const target = resolveRef.current(pos.x, pos.y);
      if (!target) {
        if (shownKey) clear();
        return;
      }
      e.preventDefault();
      if (!target.canDelete) {
        armed = null;
        show({ kind: "denied", rect: target.rect, x: pos.x, y: pos.y }, target.key, DENIED_MS);
        return;
      }
      const press = pressDelete(armed, target.key, Date.now(), { opensDialog: target.opensDialog });
      if (press.action === "arm") {
        armed = press.armed;
        show({ kind: "confirm", rect: target.rect, x: pos.x, y: pos.y }, target.key, DELETE_CONFIRM_MS);
      } else if (press.action === "confirm") {
        clear();
        confirmRef.current(press.key);
      }
    };
    // The outlined box no longer matches the task once the view moves
    const onScroll = () => { if (shownKey) clear(); };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("blur", onScroll);
    return () => {
      clearTimeout(timer);
      setHint(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onScroll);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("blur", onScroll);
    };
  }, [enabled]);

  // The task tooltip makes way for the hint
  useEffect(() => {
    if (!hint) return;
    document.body.dataset.deleteShortcut = "";
    return () => { delete document.body.dataset.deleteShortcut; };
  }, [hint]);

  return hint;
}
