"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface UseScrollSentinelsOptions {
  /** Horizontally scrolling container (typically the virtualizer's
   *  `parentRef`). The observer is created with this container as `root`. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Callback fired when the left sentinel is visible. */
  onLeftReached: () => void;
  /** Callback fired when the right sentinel is visible. */
  onRightReached: () => void;
  /** Fully disables the observers (e.g. hours view where time-based
   *  pagination does not apply). */
  enabled?: boolean;
}

/**
 * Creates 2 IntersectionObservers attached to the scrollable container. When a
 * sentinel becomes visible, the matching callback is fired.
 *
 * Returns 2 callback refs to plug into the sentinel `<div>`s. A `useState`
 * stores the nodes (rather than a `useRef`) so that the `useEffect` fires
 * again as soon as the sentinels are mounted. Otherwise, if the sentinels
 * are rendered conditionally (e.g. after the 1st task fetch),
 * `useEffect` would stay without an attached observer because `ref.current`
 * changes do not re-run effects.
 *
 * TanStack Query already blocks double fetches internally (idempotent on
 * queryKey + pageParam), so no custom throttle/debounce is needed here.
 */
export function useScrollSentinels({
  scrollRef,
  onLeftReached,
  onRightReached,
  enabled = true,
}: UseScrollSentinelsOptions) {
  const [leftNode, setLeftNode] = useState<HTMLDivElement | null>(null);
  const [rightNode, setRightNode] = useState<HTMLDivElement | null>(null);

  // Refs to avoid recreating the observers when the callbacks change
  // identity on every parent render.
  const onLeftReachedRef = useRef(onLeftReached);
  const onRightReachedRef = useRef(onRightReached);
  onLeftReachedRef.current = onLeftReached;
  onRightReachedRef.current = onRightReached;

  // Callback refs: assigned through `ref={leftRef}` on the `<div>`. When the
  // node is attached, `setLeftNode(node)` updates the state and
  // the `useEffect` below re-runs to attach the observer.
  const leftRef = useCallback((node: HTMLDivElement | null) => {
    setLeftNode(node);
  }, []);
  const rightRef = useCallback((node: HTMLDivElement | null) => {
    setRightNode(node);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = scrollRef.current;
    if (!root || !leftNode || !rightNode) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === leftNode) {
            onLeftReachedRef.current();
          } else if (entry.target === rightNode) {
            onRightReachedRef.current();
          }
        }
      },
      {
        root,
        // threshold 0: fires as soon as 1 px of the sentinel is visible.
        threshold: 0,
        // Positive horizontal rootMargin: virtually widens the viewport
        // by 200 px on the left and right. The sentinel is therefore seen as
        // intersecting 200 px BEFORE it actually appears, which preloads
        // the adjacent month and hides network latency.
        rootMargin: "0px 200px 0px 200px",
      }
    );

    observer.observe(leftNode);
    observer.observe(rightNode);

    return () => {
      observer.disconnect();
    };
  }, [scrollRef, leftNode, rightNode, enabled]);

  return { leftRef, rightRef };
}
