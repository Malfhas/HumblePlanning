"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LogLevel, LogCategory, LogEntry } from "@/lib/logger";
import { apiFetch } from "@/lib/api-client";

interface LogFilters {
  level?: LogLevel;
  category?: LogCategory;
  search?: string;
  limit?: number;
}

export function useLogs(filters: LogFilters, enabled = true) {
  const params = new URLSearchParams();
  if (filters.level) params.set("level", filters.level);
  if (filters.category) params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search);
  if (filters.limit) params.set("limit", String(filters.limit));

  return useQuery({
    queryKey: ["logs", filters],
    queryFn: () =>
      apiFetch<{ data: LogEntry[]; total: number }>(`/api/logs?${params}`),
    enabled,
    refetchInterval: false,
  });
}

export function useClearLogs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/logs", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
  });
}
