"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/use-permissions";
import { usePlanningStore } from "@/stores/planning-store";
import { useConfig } from "@/hooks/use-config";
import { useProfile } from "@/hooks/use-profile";
import { PlanningCanvas } from "@/components/planning/planning-canvas";
import { PlanningCanvasHours } from "@/components/planning/planning-canvas-hours";
import { PlanningSkeleton } from "@/components/planning/planning-skeleton";
import { CalendarGrid } from "@/components/planning/calendar-grid";
import { ErrorState } from "@/components/shared/error-state";
import { usePlanningData } from "@/hooks/use-planning-data";
import { throwIfNotOk } from "@/lib/api-client";

/**
 * Lightweight helper for `prefetchQuery` (equivalent to the hooks' inline
 * `fetchApi`, duplicated here to avoid a cross dependency use-projects.ts
 * ↔ planning/page.tsx).
 */
async function prefetchApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  await throwIfNotOk(res);
  return res.json();
}

const subscribeNoop = () => () => {};

export default function PlanningPage() {
  const { can, isLoading: permLoading } = usePermissions();
  const router = useRouter();
  const columnMode = usePlanningStore((s) => s.columnMode);
  const calendarMode = usePlanningStore((s) => s.calendarMode);
  // False during server render and hydration, true afterwards: the calendar mode
  // comes from localStorage (store), which the server ignores → same skeleton on
  // both sides on first render, otherwise a hydration mismatch in calendar mode.
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const initFromConfig = usePlanningStore((s) => s.initFromConfig);
  const applyUserDefaults = usePlanningStore((s) => s.applyUserDefaults);
  const applyMobileCap = usePlanningStore((s) => s.applyMobileCap);
  const { data: config } = useConfig();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();

  // Prefetch the dialog caches when idle (TaskFormDialog + ExportPanel)
  // so that on the 1st click on "Edit task" or "Export", everything is
  // already warm — zero perceived latency. Started after idle so as NOT
  // to compete with /api/tasks (the canvas's blocking request) for
  // bandwidth on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const run = () => {
      const opts = { staleTime: 30_000 };
      queryClient.prefetchQuery({
        queryKey: ["projects", undefined, undefined, false],
        queryFn: () => prefetchApi(`/api/projects`),
        ...opts,
      });
      queryClient.prefetchQuery({
        queryKey: ["users", undefined, true, false],
        queryFn: () => prefetchApi(`/api/users?`),
        ...opts,
      });
      queryClient.prefetchQuery({
        queryKey: ["users", undefined, false, false],
        queryFn: () => prefetchApi(`/api/users?active=false`),
        ...opts,
      });
      queryClient.prefetchQuery({
        queryKey: ["statuses"],
        queryFn: () => prefetchApi(`/api/statuses`),
        ...opts,
      });
      queryClient.prefetchQuery({
        queryKey: ["resources", true],
        queryFn: () => prefetchApi(`/api/resources?includeOutOfService=true`),
        ...opts,
      });
    };
    // requestIdleCallback: Chromium/Firefox. Safari (and others) → setTimeout
    // 500 ms to let the canvas finish its 1st paint + scroll into place.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(run, { timeout: 2000 });
      return () => {
        const cw = window as Window & { cancelIdleCallback?: (h: number) => void };
        cw.cancelIdleCallback?.(handle);
      };
    } else {
      const t = setTimeout(run, 500);
      return () => clearTimeout(t);
    }
  }, [queryClient]);

  // Redirect if user doesn't have pages:planning but has pages:home
  useEffect(() => {
    if (permLoading) return;
    if (!can("pages:planning") && can("pages:home")) {
      router.replace("/home");
    }
  }, [permLoading, can, router]);
  const initialized = useRef(false);

  // Initialize default period from config (once)
  useEffect(() => {
    if (initialized.current || !config) return;
    const raw = config.DEFAULT_NB_MONTHS_DISPLAYED;
    const months = raw ? parseInt(raw, 10) : 2;
    const parseNum = (raw: string | null | undefined) => {
      if (!raw) return undefined;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const cellWidthConfig = {
      min: parseNum(config.PLANNING_MIN_CELL_WIDTH),
      max: parseNum(config.PLANNING_MAX_CELL_WIDTH),
      defaultW: parseNum(config.PLANNING_DEFAULT_CELL_WIDTH),
      mobileMax: parseNum(config.PLANNING_MAX_CELL_WIDTH_MOBILE),
    };
    if (!isNaN(months) && months > 0) {
      initFromConfig(months, cellWidthConfig);
      // Apply the mobile cap once the admin range is known.
      applyMobileCap();
    }
    initialized.current = true;
  }, [config, initFromConfig, applyMobileCap]);

  // Re-apply the mobile cap on resize/rotation. The user pref stays
  // intact in localStorage: only the effective value is recomputed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => applyMobileCap();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyMobileCap]);

  // Apply user preferences as defaults when localStorage is empty (new device)
  const prefsApplied = useRef(false);
  useEffect(() => {
    if (prefsApplied.current || !profile?.preferences) return;
    const prefs = profile.preferences as { defaultView?: string; columnView?: string };
    applyUserDefaults({ viewMode: prefs.defaultView, columnMode: prefs.columnView });
    prefsApplied.current = true;
  }, [profile, applyUserDefaults]);

  // Centralizes all planning loading here (except calendar mode, which has
  // its own logic). The DOM skeleton is rendered CONTINUOUSLY until
  // EVERYTHING is ready:
  //   - permissions loaded
  //   - profile loaded (otherwise `applyUserDefaults` changes the store
  //     AFTER the 1st render → gridKey changes → canvas remount →
  //     2nd skeleton instance that animates again)
  //   - rows and 1st tasks response loaded
  // Switching from the skeleton to the canvas happens ALL AT ONCE, with no
  // empty intermediate state nor a 2nd flashing skeleton.
  const isHoursMode = calendarMode === "off" && columnMode === "hours";
  const isCanvasMode = calendarMode === "off";
  // These queries are already fired by usePlanningData elsewhere; TanStack
  // dedupes via an identical queryKey → no network cost.
  const planningData = usePlanningData();

  if (!permLoading && !can("pages:planning")) {
    return <ErrorState code={403} compact showBack={false} />;
  }
  // Skeleton as long as the foundations are not ready (canvas mode).
  // Calendar mode: no skeleton, the CalendarGrid component handles it.
  const isInitialLoading =
    permLoading ||
    !profile ||
    (isCanvasMode && (planningData.isLoadingRows || planningData.isLoadingTasks));
  if (!hydrated || (isCanvasMode && isInitialLoading)) {
    return (
      <div className="-m-3 md:-m-6 flex h-[calc(100vh-3.5rem)] flex-col">
        <PlanningSkeleton />
      </div>
    );
  }

  void isHoursMode;

  // Wrapper key = active mode → forces a clean remount on switch and
  // triggers the opacity transition defined via Tailwind (avoids the
  // task repositioning glitch during the re-render).
  const gridKey =
    calendarMode !== "off"
      ? `calendar-${calendarMode}`
      : columnMode === "hours"
        ? "hours"
        : "days";

  const content = (
    <div className="-m-3 md:-m-6 flex h-[calc(100vh-3.5rem)] flex-col">
      <div key={gridKey} className="flex-1 min-h-0 animate-in fade-in duration-200">
        {calendarMode !== "off" ? (
          <CalendarGrid />
        ) : columnMode === "hours" ? (
          <PlanningCanvasHours />
        ) : (
          <PlanningCanvas />
        )}
      </div>
    </div>
  );

  return content;
}
