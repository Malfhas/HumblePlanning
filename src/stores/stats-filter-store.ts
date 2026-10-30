"use client";

import { create } from "zustand";

interface StatsFilterState {
  startDate: string;
  endDate: string;
  userIds: string[];
  teamIds: string[];
  projectIds: string[];
  laborTypeIds: string[];
  businessUnitIds: string[];
  granularity: "day" | "week" | "month";
  // Override toggles (null = use config default)
  includeWeekends: boolean | null;
  includeHolidays: boolean | null;

  setStartDate: (d: string) => void;
  setEndDate: (d: string) => void;
  setUserIds: (ids: string[]) => void;
  setTeamIds: (ids: string[]) => void;
  setProjectIds: (ids: string[]) => void;
  setLaborTypeIds: (ids: string[]) => void;
  setBusinessUnitIds: (ids: string[]) => void;
  setGranularity: (g: "day" | "week" | "month") => void;
  setIncludeWeekends: (v: boolean | null) => void;
  setIncludeHolidays: (v: boolean | null) => void;
  reset: () => void;
  toQueryString: () => string;
}

// Default: last 12 months
const now = new Date();
const defaultStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
const fmt = (d: Date) => d.toISOString().split("T")[0];

const DEFAULTS = {
  startDate: fmt(defaultStart),
  endDate: fmt(now),
  userIds: [] as string[],
  teamIds: [] as string[],
  projectIds: [] as string[],
  laborTypeIds: [] as string[],
  businessUnitIds: [] as string[],
  granularity: "month" as const,
  includeWeekends: null as boolean | null,
  includeHolidays: null as boolean | null,
};

export const useStatsFilterStore = create<StatsFilterState>((set, get) => ({
  ...DEFAULTS,
  setStartDate: (d) => set({ startDate: d }),
  setEndDate: (d) => set({ endDate: d }),
  setUserIds: (ids) => set({ userIds: ids }),
  setTeamIds: (ids) => set({ teamIds: ids }),
  setProjectIds: (ids) => set({ projectIds: ids }),
  setLaborTypeIds: (ids) => set({ laborTypeIds: ids }),
  setBusinessUnitIds: (ids) => set({ businessUnitIds: ids }),
  setGranularity: (g) => set({ granularity: g }),
  setIncludeWeekends: (v) => set({ includeWeekends: v }),
  setIncludeHolidays: (v) => set({ includeHolidays: v }),
  reset: () => set(DEFAULTS),
  toQueryString: () => {
    const s = get();
    const p = new URLSearchParams();
    p.set("startDate", s.startDate);
    p.set("endDate", s.endDate);
    p.set("granularity", s.granularity);
    if (s.userIds.length) p.set("userIds", s.userIds.join(","));
    if (s.teamIds.length) p.set("teamIds", s.teamIds.join(","));
    if (s.projectIds.length) p.set("projectIds", s.projectIds.join(","));
    if (s.laborTypeIds.length) p.set("laborTypeIds", s.laborTypeIds.join(","));
    if (s.businessUnitIds.length) p.set("businessUnitIds", s.businessUnitIds.join(","));
    if (s.includeWeekends !== null) p.set("includeWeekends", String(s.includeWeekends));
    if (s.includeHolidays !== null) p.set("includeHolidays", String(s.includeHolidays));
    return p.toString();
  },
}));
