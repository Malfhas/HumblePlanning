/**
 * Canvas animation system for schedule tasks.
 *
 * Animations live in the `CanvasRenderer` (not in CSS, not in React
 * state) and are interpolated with rAF. Goal: every interaction
 * (move, resize, create, delete) gets smooth, "Apple-like" visual
 * feedback without depending on the backend response cycle (mutations
 * are already optimistic via TanStack Query, but the canvas
 * snaps to the grid without a tween → glitches).
 *
 * Pattern: the React component calls `startXxxAnimation()` when the
 * gesture happens, the renderer interpolates for N ms, then the anim
 * cleans itself up. drawTasks reads the anim state and applies the
 * transformation (offset, scale, alpha) before drawing the bar.
 */

// ──────────────────────────────────────────────────────────────────
// Easings — "Apple-like" curves (fast at first, then slow down)
// ──────────────────────────────────────────────────────────────────

/** easeOutCubic: standard, neutral. Good for resize. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** easeOutQuart: a bit more pronounced. */
export const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

/** easeOutExpo: very fast at first, gliding at the end. Ideal for move. */
export const easeOutExpo = (t: number): number =>
  t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);

/** easeOutBack: slight overshoot (1.07x) to give an Apple "pop" when
 *  a new task appears. */
export const easeOutBack = (t: number): number => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** easeInQuad: soft but firm disappearance. */
export const easeInQuad = (t: number): number => t * t;

// ──────────────────────────────────────────────────────────────────
// Durations (ms) — short and snappy, not too slow
// ──────────────────────────────────────────────────────────────────

export const ANIM_DURATIONS = {
  /** Drag drop: the bar slides to its new position. */
  move: 220,
  /** Bar resize: the width adjusts, a bit longer so the
   *  day transition is clearly felt. */
  resize: 240,
  /** A new task appears (creation, copy, paste). */
  appear: 200,
  /** A deleted task disappears. */
  delete: 160,
} as const;

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface BaseAnim {
  startTime: number;
  duration: number;
  easing: (t: number) => number;
}

export interface MoveAnim extends BaseAnim {
  kind: "move";
  /** Offset applied to the bar, progressively cancelled out.
   *  At t=0, we offset by (from - to) to show the bar at `from`.
   *  At t=1, offset = 0 → the bar is at `to` (its position in the cache). */
  offsetX: number;
  offsetY: number;
}

export interface ResizeAnim extends BaseAnim {
  kind: "resize";
  /** X offset and width delta to cancel out progressively. */
  offsetX: number;
  offsetWidth: number;
}

export interface AppearAnim extends BaseAnim {
  kind: "appear";
}

export interface DeleteAnim extends BaseAnim {
  kind: "delete";
}

export type TaskAnim = MoveAnim | ResizeAnim | AppearAnim | DeleteAnim;

/** Effect applied to a bar at the current tick. All fields have a
 *  neutral default (offset=0, alpha=1, scaleX=1) when no
 *  animation is active. */
export interface AnimEffect {
  offsetX: number;
  offsetY: number;
  offsetWidth: number;
  alpha: number;
  scaleX: number;
}

export const NEUTRAL_EFFECT: AnimEffect = {
  offsetX: 0,
  offsetY: 0,
  offsetWidth: 0,
  alpha: 1,
  scaleX: 1,
};

/** Computes the visual effect of an animation at a given instant. */
export function computeAnimEffect(anim: TaskAnim, now: number): AnimEffect {
  const elapsed = now - anim.startTime;
  const t = Math.max(0, Math.min(1, elapsed / anim.duration));
  const eased = anim.easing(t);

  switch (anim.kind) {
    case "move": {
      // At t=0, offset = (from - to); at t=1, offset = 0.
      // We store offsetX = (fromX - toX) and multiply by (1 - eased).
      const k = 1 - eased;
      return {
        ...NEUTRAL_EFFECT,
        offsetX: anim.offsetX * k,
        offsetY: anim.offsetY * k,
      };
    }
    case "resize": {
      const k = 1 - eased;
      return {
        ...NEUTRAL_EFFECT,
        offsetX: anim.offsetX * k,
        offsetWidth: anim.offsetWidth * k,
      };
    }
    case "appear": {
      // Starts invisible and small, ends normal.
      return {
        ...NEUTRAL_EFFECT,
        alpha: eased,
        scaleX: 0.92 + 0.08 * eased,
      };
    }
    case "delete": {
      // Starts normal, ends invisible and shrunk.
      return {
        ...NEUTRAL_EFFECT,
        alpha: 1 - eased,
        scaleX: 1 - 0.08 * eased,
      };
    }
  }
}

/** True when the animation is finished (to be cleaned up). */
export function isAnimDone(anim: TaskAnim, now: number): boolean {
  return now - anim.startTime >= anim.duration;
}
