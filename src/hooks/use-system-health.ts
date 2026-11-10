"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { LogCategory, StoredLevel, SystemTask } from "@/lib/system-health/categories";
import type { ConfigAlert } from "@/lib/services/system-health-service";

export interface SystemOverview {
  database: { ok: true; latencyMs: number } | { ok: false; error: string };
  realtime: { ok: true; clients: number | null; uptimeSeconds: number | null } | { ok: false; error: string };
  version: {
    currentVersion: string;
    status: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    securityUpdate: boolean;
    checkedAt: string | null;
  };
  backup: { createdAt: string; status: string; triggerType: string; sizeBytes: number; errorMessage: string | null } | null;
  alerts: ConfigAlert[];
  /** Instant of the server when it answered, and the time zone of the instance (e-mails, exports, schedules). */
  clock: { now: string; timeZone: string };
  tasks: {
    task: SystemTask;
    enabled: boolean;
    nextRunAt: string | null;
    lastRun: { startedAt: string; finishedAt: string | null; success: boolean | null; detail: Record<string, unknown> | null } | null;
  }[];
}

export interface SystemEvent {
  id: string;
  level: StoredLevel;
  category: LogCategory | string;
  message: string;
  metadata: unknown;
  stack: string | null;
  route: string | null;
  method: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  userId: string | null;
  userName: string | null;
}

export interface SystemEventFilters {
  days: string;
  levels: string[];
  categories: string[];
  search: string;
}

export interface FailedDeliveries {
  emails: { id: string; at: string; recipient: string; subject: string | null; error: string | null; provider: string | null }[];
  sms: { id: string; at: string; recipient: string; error: string | null; provider: string | null }[];
  webhooks: { id: string; at: string; provider: string; eventType: string; status: string; error: string | null }[];
}

export function useSystemOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["system-health", "overview"],
    queryFn: () => apiFetch<SystemOverview>("/api/system-health"),
    enabled,
  });
}

export function useSystemEvents(filters: SystemEventFilters, page: number, limit: number, enabled: boolean) {
  const params = new URLSearchParams({ days: filters.days, page: String(page), limit: String(limit) });
  if (filters.levels.length) params.set("levels", filters.levels.join(","));
  if (filters.categories.length) params.set("categories", filters.categories.join(","));
  if (filters.search) params.set("search", filters.search);
  return useQuery({
    queryKey: ["system-health", "events", filters, page, limit],
    queryFn: () => apiFetch<{ data: SystemEvent[]; total: number; page: number; limit: number }>(`/api/system-health/events?${params}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFailedDeliveries(days: string, enabled: boolean) {
  return useQuery({
    queryKey: ["system-health", "deliveries", days],
    queryFn: () => apiFetch<FailedDeliveries>(`/api/system-health/deliveries?${new URLSearchParams({ days })}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function previewSystemEventsPurge(before: string) {
  return apiFetch<{ events: number }>(`/api/system-health/purge?${new URLSearchParams({ before })}`);
}

export function usePurgeSystemEvents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (before: string) =>
      apiFetch<{ events: number }>("/api/system-health/purge", { method: "DELETE", body: JSON.stringify({ before }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["system-health"] }),
  });
}
