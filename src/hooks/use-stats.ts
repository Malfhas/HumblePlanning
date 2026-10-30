"use client";

import { useQuery } from "@tanstack/react-query";
import { useStatsFilterStore } from "@/stores/stats-filter-store";
import { useBuStore } from "@/stores/bu-store";
import { apiFetch } from "@/lib/api-client";

/**
 * Build query string merging stats filter store with header BU selector.
 * Header BU selector overrides the stats filter BU when active.
 */
function useStatsQueryString(): string {
  const baseQs = useStatsFilterStore((s) => s.toQueryString());
  const { selectedBuIds } = useBuStore();

  if (selectedBuIds.length === 0) return baseQs;

  // Override businessUnitIds in the query string with header BU selector
  const params = new URLSearchParams(baseQs);
  params.set("businessUnitIds", selectedBuIds.join(","));
  return params.toString();
}

export function useStatsUsers() {
  const qs = useStatsQueryString();
  return useQuery({
    queryKey: ["stats", "users", qs],
    queryFn: () => apiFetch<any>(`/api/stats/users?${qs}`),
    staleTime: 300000,
  });
}

export function useStatsProjects() {
  const qs = useStatsQueryString();
  return useQuery({
    queryKey: ["stats", "projects", qs],
    queryFn: () => apiFetch<any>(`/api/stats/projects?${qs}`),
    staleTime: 300000,
  });
}

export function useStatsRoi() {
  const qs = useStatsQueryString();
  return useQuery({
    queryKey: ["stats", "roi", qs],
    queryFn: () => apiFetch<any>(`/api/stats/roi?${qs}`),
    staleTime: 300000,
  });
}
