import { useSyncExternalStore } from "react";

/**
 * Phone: a single breakpoint, 768 px, Tailwind's `md`. `max-md:` in the
 * markup and `useIsPhone()` in the code say the same thing (the application's
 * `useIsMobile`, at 640 px, would not match `max-md:`).
 */
export const PHONE_QUERY = "(max-width: 767px)";

const NOOP_SUBSCRIPTION = () => () => {};

export function useMediaQuery(query: string): boolean {
  const subscribe = (notify: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return NOOP_SUBSCRIPTION();
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  };
  const read = () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);
  return useSyncExternalStore(subscribe, read, () => false);
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
