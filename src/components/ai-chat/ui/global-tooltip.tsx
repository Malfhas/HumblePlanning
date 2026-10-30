"use client";

import { useEffect, useState, type PointerEvent as PointerEventReact } from 'react';
import { createPortal } from 'react-dom';

/**
 * The tooltip for truncated text, custom rather than native, and single for
 * the whole AI chat (limited to elements under `[data-ai-chat]` and to
 * portaled `.ai-chat-portal` content).
 *
 * The browser `title` attribute only shows after a second and cannot be
 * tuned: to read a label cut by "…", that is too long. This one
 * shows in 150 ms, follows the mouse, sits on the side where there is
 * room left, and fades as soon as you click, grab a row or
 * scroll.
 *
 * Three sources, a single tooltip:
 * - any element carrying `data-tooltip="text"` (button, column
 *   header, icon) shows that text: it is the short explanation of a
 *   command or a column, where `title` took a second to come and looked
 *   like nothing. It takes precedence over the other two;
 * - any truncated element (`truncate`, `line-clamp-*`) that actually overflows
 *   shows its full text on hover, wherever it is: tables, lists,
 *   sidebar. Nothing to wire;
 * - a table row can carry its own tooltip across its full width
 *   (`tooltipRowProps`, or simply `data-tooltip-row="auto"` on the
 *   container): the label reads wherever the mouse comes from, not only
 *   from the text. In such a row, the truncated-text source
 *   stays silent, as under a rich card (`Tooltip`, marked
 *   `data-tooltip-rich`): a Gantt bar does not need two tooltips.
 *
 * A single component, mounted at the root, driven by calls: rows
 * have nothing to render, and the screen does not redraw on every move.
 */

type Source = 'row' | 'truncated' | 'explicit';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  source: Source;
  element?: Element;
}

interface TooltipController {
  show(text: string, x: number, y: number, source: Source, element?: Element): void;
  move(x: number, y: number): void;
  hide(source?: Source): void;
}

/** The mounted instance; null until the root is rendered. */
let controller: TooltipController | null = null;

/** Short enough to feel immediate, long enough not to flicker when the mouse crosses a table. */
const DELAY_MS = 150;

/** What gets cut with "…": the Tailwind utilities the site uses for that. */
export const TRUNCATED = '.truncate, .line-clamp-1, .line-clamp-2, .line-clamp-3';

const INTERACTIVE = 'button, a, input, select, textarea, [role="combobox"], [role="button"]';

/** An element that explains itself what it does; the row tooltip fades over it. */
const EXPLICIT = '[data-tooltip]';

/**
 * Does the text really overflow its box? Without overflow, no "…",
 * so nothing to show.
 *
 * `scrollWidth` and `clientWidth` are rounded to the integer: a text longer
 * by less than a pixel still gets its ellipsis (which eats
 * two or three letters), but both measures read equal and the tooltip
 * did not come. It is the typical case of a title cut "by very little". So
 * we measure the text itself, to a tenth of a pixel, when rounding is not
 * enough.
 */
export function overflows(element: Element): boolean {
  if (element.scrollHeight > element.clientHeight + 1) return true;
  if (element.scrollWidth > element.clientWidth + 1) return true;
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width > element.getBoundingClientRect().width + 0.1;
}

export function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let latest: TooltipState | null = null;
    let visible = false;

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      latest = null;
      visible = false;
      setTooltip(null);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!latest) return;
        visible = true;
        setTooltip({ ...latest });
      }, DELAY_MS);
    };
    const instance: TooltipController = {
      show: (text, x, y, source, element) => {
        // Same text continuing: the tooltip follows, without starting over
        if (latest && latest.text === text && latest.source === source) {
          instance.move(x, y);
          return;
        }
        latest = { text, x, y, source, element };
        visible = false;
        setTooltip(null);
        schedule();
      },
      move: (x, y) => {
        if (!latest) return;
        latest = { ...latest, x, y };
        if (visible) setTooltip({ ...latest });
        else if (timer === undefined) schedule();
      },
      hide: (source) => {
        if (source && latest && latest.source !== source) return;
        hide();
      },
    };
    controller = instance;

    const onPointerMove = (event: PointerEvent) => {
      // With a finger, there is no hover: a tooltip following the touch
      // would stay on top of what you are trying to read
      if (event.pointerType === 'touch') return;
      const origin = event.target as Element | null;
      // Limited to the AI chat (page, sphere and their portaled menus): the rest of
      // the application keeps its own tooltips.
      if (!origin?.closest?.('[data-ai-chat], .ai-chat-portal')) {
        if (latest) hide();
        return;
      }
      // An explanation set on the element itself takes precedence over everything else
      const explicit = origin?.closest?.(EXPLICIT) ?? null;
      const explanation = explicit?.getAttribute('data-tooltip')?.trim();
      if (explicit && explanation) {
        instance.show(explanation, event.clientX, event.clientY, 'explicit', explicit);
        return;
      }
      if (latest?.source === 'explicit') hide();
      // A row marked `data-tooltip-row="auto"` carries the tooltip of its
      // truncated text over its whole surface, with no handler to wire: it is
      // the table rule, offered to any list (tasks, cards, trees).
      // Over a command of the row, the tooltip fades; the row
      // itself may be a button.
      const autoRow = origin?.closest?.('[data-tooltip-row="auto"]') ?? null;
      // `Element` and not `HTMLElement`: at the center of an icon button, the
      // mouse is on an `svg`, and we still need to know we are on
      // a command of the row to hide the tooltip.
      if (autoRow instanceof HTMLElement && origin instanceof Element) {
        const command = origin.closest(`${INTERACTIVE}, ${EXPLICIT}, [data-tooltip-rich]`);
        const text =
          command && command !== autoRow
            ? undefined
            : rowTruncatedText(autoRow, origin);
        if (text)
          instance.show(text, event.clientX, event.clientY, 'row', autoRow);
        else if (latest?.source === 'row') hide();
        return;
      }
      // Truncated texts, wherever there is no row tooltip already
      const target = origin?.closest?.(TRUNCATED) ?? null;
      const outOfScope =
        !target ||
        target.closest('[data-tooltip-row], [data-tooltip-rich], [title]') !== null ||
        !overflows(target);
      if (outOfScope) {
        if (latest?.source === 'truncated') hide();
        return;
      }
      const text = target.textContent?.trim();
      if (!text) return;
      instance.show(text, event.clientX, event.clientY, 'truncated', target);
    };
    const onPointerOut = (event: PointerEvent) => {
      // Rows with React handlers close themselves (onPointerLeave)
      if (latest?.source === 'row' && !latest.element) return;
      if (!latest?.element) return;
      const next = event.relatedTarget as Node | null;
      if (!next || !latest.element.contains(next)) hide();
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('dragstart', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('dragstart', hide);
      window.removeEventListener('scroll', hide, true);
      window.clearTimeout(timer);
      if (controller === instance) controller = null;
    };
  }, []);

  if (!tooltip) return null;
  const toTheLeft = tooltip.x > window.innerWidth * 0.6;
  const above = tooltip.y > window.innerHeight - 96;
  return createPortal(
    <div
      role="tooltip"
      className="ai-chat-portal pointer-events-none fixed z-[80] max-w-md whitespace-pre-line rounded-ai-md border border-ai-border-strong bg-ai-raised px-2.5 py-1.5 text-ai-xs leading-snug text-ai-primary shadow-ai-modal max-md:max-w-[calc(100vw-1rem)]"
      style={{
        left: toTheLeft ? undefined : tooltip.x + 14,
        right: toTheLeft ? window.innerWidth - tooltip.x + 14 : undefined,
        top: above ? undefined : tooltip.y + 18,
        bottom: above ? window.innerHeight - tooltip.y + 12 : undefined,
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}

/**
 * The text to show for a table row without an explicit tooltip: the
 * truncated text under the mouse if it overflows, otherwise the first truncated
 * text of the row (its label, most often).
 */
export function rowTruncatedText(row: HTMLElement, target: Element): string | undefined {
  const underPointer = target.closest(TRUNCATED);
  if (underPointer && row.contains(underPointer) && overflows(underPointer)) {
    return underPointer.textContent?.trim() || undefined;
  }
  for (const element of row.querySelectorAll(TRUNCATED)) {
    if (overflows(element)) return element.textContent?.trim() || undefined;
  }
  return undefined;
}

/**
 * The handlers to set on a row so it carries the tooltip across
 * its full width. The text may depend on the hovered spot (function).
 * Over a button or a field of the row, the tooltip fades: what
 * that button does matters more than the row label.
 */
export function tooltipRowProps(
  text: string | undefined | ((row: HTMLElement, target: HTMLElement) => string | undefined),
) {
  const resolve = (event: PointerEventReact) =>
    typeof text === 'function'
      ? text(event.currentTarget as HTMLElement, event.target as HTMLElement)
      : text;
  // Over a command OF the row, the tooltip fades; but the row
  // itself may be a button (Gantt task column) without that
  // counting: it is the row that carries the tooltip.
  const isOverCommand = (event: PointerEventReact) => {
    const command = (event.target as HTMLElement).closest(`${INTERACTIVE}, ${EXPLICIT}`);
    return Boolean(command && command !== event.currentTarget);
  };
  const follow = (event: PointerEventReact) => {
    if (isOverCommand(event)) {
      controller?.hide('row');
      return;
    }
    const content = resolve(event);
    if (content) controller?.show(content, event.clientX, event.clientY, 'row');
    else controller?.hide('row');
  };
  return {
    'data-tooltip-row': '',
    onPointerEnter: follow,
    onPointerMove: follow,
    onPointerLeave: () => controller?.hide('row'),
  };
}
