/**
 * Device Pixel Ratio handling for Canvas rendering.
 *
 * On a Retina screen (DPR=2), a canvas displayed at 800×600 CSS px needs
 * a 1600×1200 physical pixel buffer to stay sharp. We set
 * `canvas.width = cssWidth × dpr` and apply `ctx.scale(dpr, dpr)` —
 * so all drawing code stays expressed in CSS pixels.
 *
 * IMPORTANT: `canvas.width = X` resets the content AND the transformation
 * matrix. We do it on every call to start clean.
 */

export interface HiDPISetup {
  /** 2D context ready to use (transformation matrix applied). */
  ctx: CanvasRenderingContext2D;
  /** Width in CSS pixels (used throughout the drawing code). */
  width: number;
  /** Height in CSS pixels. */
  height: number;
  /** Effective DPR applied. */
  dpr: number;
}

/**
 * Sets up a canvas to render sharply on Retina screens, honouring the
 * requested CSS size. Call on every resize or DPR change.
 *
 * @param canvas The canvas element to set up
 * @param width Desired CSS width (px)
 * @param height Desired CSS height (px)
 * @param alpha `false` for an opaque background (perf +5-10 %), `true` for a transparent overlay
 */
export function setupHiDPI(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  alpha = false
): HiDPISetup | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  // canvas.width = X resets the buffer and the transformation matrix.
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d", { alpha });
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  return { ctx, width: w, height: h, dpr };
}

/**
 * Measures a container's size via ResizeObserver, retrying with
 * `requestAnimationFrame` while the measured size is 0.
 *
 * Why the retry: when a React component mounts inside a complex flex
 * layout, `getBoundingClientRect()` can return 0×0 during
 * `useLayoutEffect` because the flex layout is not computed yet. The
 * `ResizeObserver` should fire on the next frame, but in some
 * cases (nested flex layers + `animate-in fade-in` animation) it
 * fires late or only once with the value 0. So we add an rAF
 * retry while the size stays 0, up to 30 frames (~500 ms).
 *
 * @returns Cleanup function to call on unmount.
 */
export function observeResize(
  element: HTMLElement,
  callback: (size: { width: number; height: number }) => void
): () => void {
  let cancelled = false;
  let rafId = 0;
  let retries = 0;
  const MAX_RETRIES = 30;

  const measure = () => {
    if (cancelled) return;
    const rect = element.getBoundingClientRect();
    callback({ width: rect.width, height: rect.height });
    // If the size is still 0 after mount, retry on the next frame
    if ((rect.width === 0 || rect.height === 0) && retries < MAX_RETRIES) {
      retries += 1;
      rafId = requestAnimationFrame(measure);
    }
  };
  measure();

  const ro = new ResizeObserver((entries) => {
    if (cancelled) return;
    for (const entry of entries) {
      const r = entry.contentRect;
      callback({ width: r.width, height: r.height });
      // A non-zero measurement stops the rAF retry
      if (r.width > 0 && r.height > 0 && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        retries = MAX_RETRIES; // prevents any future retry
      }
    }
  });
  ro.observe(element);

  return () => {
    cancelled = true;
    ro.disconnect();
    if (rafId) cancelAnimationFrame(rafId);
  };
}

/**
 * Watcher for DPR changes (moving between Retina/non-Retina screens,
 * system zoom). We re-listen after each change
 * via a new media query.
 *
 * @returns Cleanup function to call on unmount.
 */
export function observeDpr(callback: (dpr: number) => void): () => void {
  let mql: MediaQueryList | null = null;
  let cleanup: (() => void) | null = null;

  const subscribe = () => {
    const dpr = window.devicePixelRatio || 1;
    callback(dpr);
    // A media query only covers one DPR at a time; we subscribe to the
    // change and, when it fires, re-subscribe to the new DPR.
    mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => {
      cleanup?.();
      subscribe();
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      cleanup = () => mql?.removeEventListener("change", onChange);
    } else {
      // Safari < 14: `addListener` fallback
      mql.addListener(onChange);
      cleanup = () => mql?.removeListener(onChange);
    }
  };
  subscribe();

  return () => {
    cleanup?.();
  };
}
