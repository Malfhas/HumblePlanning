"use client";
// Refs read during render (pattern from the original project): no automatic memoization
"use no memo";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from "@/lib/utils";

/**
 * The sphere radial menu: a long press makes it appear around
 * the sphere, dragging the sphere onto an entry triggers it, releasing elsewhere
 * closes everything. A short click keeps its role (open the chat).
 *
 * Everything is pointer-driven, with no library: `pointerdown` arms a delay,
 * `pointermove` moves the sphere ghost around, `pointerup` looks under the
 * finger. Touch is not supported: on phone, the sphere carries
 * a permanent cross, and the radial menu follows the mouse.
 *
 * One more target, in the bottom-right corner: dropping the sphere there
 * hides it, like the cross it carries. It only arms once the sphere
 * has left its place, otherwise releasing without moving would hide it.
 */
export interface RadialMenuEntry {
  id: string;
  label: string;
  icon: ReactNode;
  /** Angle of the entry around the sphere, in degrees (0 = right, clockwise). */
  angle: number;
  onChoose: () => void;
}

const PRESS_DELAY_MS = 220;
/** Distance from the bubbles to the sphere: enough for two neighbours not to touch. */
const RADIUS = 128;
/** Distance from the close target center to the window edges. */
const CORNER_MARGIN = 34;
const CLOSE_ID = 'close';

export function useRadialMenu(
  items: RadialMenuEntry[],
  enabled: boolean,
  onHide?: () => void,
) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  /** The sphere has left its place: the close target, which covers it, can arm. */
  const hasLeft = useRef(false);

  const reset = () => {
    if (delay.current) clearTimeout(delay.current);
    delay.current = null;
    pressed.current = false;
    hasLeft.current = false;
    setOpen(false);
    setHovered(null);
    setGhost(null);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!enabled || event.button !== 0 || event.pointerType === 'touch') return;
    pressed.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    delay.current = setTimeout(() => {
      if (!pressed.current) return;
      setOpen(true);
      setGhost({ x: origin.current!.x, y: origin.current!.y });
    }, PRESS_DELAY_MS);
  };

  useEffect(() => {
    if (!open) return;
    const itemUnder = (x: number, y: number): string | null => {
      const o = origin.current!;
      for (const entry of items) {
        const rad = (entry.angle * Math.PI) / 180;
        const cx = o.x + Math.cos(rad) * RADIUS;
        const cy = o.y + Math.sin(rad) * RADIUS;
        if (Math.hypot(x - cx, y - cy) < 42) return entry.id;
      }
      const corner = cornerPosition();
      if (onHide && hasLeft.current && Math.hypot(x - corner.x, y - corner.y) < 32) return CLOSE_ID;
      return null;
    };
    const onMove = (event: PointerEvent) => {
      const o = origin.current!;
      if (Math.hypot(event.clientX - o.x, event.clientY - o.y) > 48) hasLeft.current = true;
      setGhost({ x: event.clientX, y: event.clientY });
      setHovered(itemUnder(event.clientX, event.clientY));
    };
    const onUp = (event: PointerEvent) => {
      const chosen = itemUnder(event.clientX, event.clientY);
      reset();
      if (chosen === CLOSE_ID) onHide?.();
      else if (chosen) items.find((entry) => entry.id === chosen)?.onChoose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, items, onHide]);

  /** Released before the delay: it is a click, the menu did not open. */
  const onPointerUp = () => {
    if (!open) reset();
  };

  return {
    open,
    hovered,
    ghost,
    origin: origin.current,
    corner: onHide ? cornerPosition() : null,
    onPointerDown,
    onPointerUp,
  };
}

function cornerPosition() {
  return { x: window.innerWidth - CORNER_MARGIN, y: window.innerHeight - CORNER_MARGIN };
}

export function RadialMenu({
  items,
  origin,
  hovered,
  ghost,
  corner,
  sphere,
}: {
  items: RadialMenuEntry[];
  origin: { x: number; y: number };
  hovered: string | null;
  ghost: { x: number; y: number } | null;
  /** The close target, if the sphere can be hidden. */
  corner: { x: number; y: number } | null;
  sphere: ReactNode;
}) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
      <div className="ai-menu-voile" />
      {items.map((entry) => {
        const rad = (entry.angle * Math.PI) / 180;
        return (
          <div
            key={entry.id}
            className={cn('ai-menu-entree', hovered === entry.id && 'ai-menu-entree--survol')}
            style={{
              left: origin.x + Math.cos(rad) * RADIUS,
              top: origin.y + Math.sin(rad) * RADIUS,
            }}
          >
            <span className="ai-menu-icone">{entry.icon}</span>
            <span className="ai-menu-libelle">{entry.label}</span>
          </div>
        );
      })}
      {corner ? (
        <div
          className={cn('ai-menu-entree', hovered === CLOSE_ID && 'ai-menu-entree--survol')}
          style={{ left: corner.x, top: corner.y }}
        >
          <span className="ai-menu-icone">
            <X className="size-5" />
          </span>
        </div>
      ) : null}
      {ghost ? (
        <div className="ai-menu-fantome" style={{ left: ghost.x, top: ghost.y }}>
          {sphere}
        </div>
      ) : null}
    </div>
  );
}
