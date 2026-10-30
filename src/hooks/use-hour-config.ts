"use client";

import { useMemo } from "react";
import { useConfig } from "./use-config";
import { parseHoursConfig, buildTimeSlots, type TimeSlot } from "@/lib/utils/time-slots";

export interface HourConfig {
  hours: number[];
  slots: TimeSlot[];
  isLoading: boolean;
}

export function useHourConfig(): HourConfig {
  const { data: config, isLoading } = useConfig();

  return useMemo(() => {
    const hours = parseHoursConfig(config?.HOURS_DISPLAYED);
    const slots = buildTimeSlots(hours);
    return { hours, slots, isLoading };
  }, [config, isLoading]);
}
