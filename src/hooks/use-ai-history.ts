"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

/** Filters of the AI history page (`days`: "7" | "30" | "90" | "all"). */
export interface AiHistoryFilters {
  days: string;
  userIds: string[];
  models: string[];
}

export interface AiHistoryConversation {
  id: string;
  title: string;
  updatedAt: string;
  deletedAt: string | null;
  userId: string;
  userName: string | null;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: string;
  errors: number;
  models: string[];
}

export interface AiHistorySummary {
  kpis: {
    conversations: number;
    messages: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    errors: number;
    averageDurationMs: number;
  };
  costByDay: { day: string; costUsd: number }[];
  timeZone: string;
}

export interface AiHistoryToolCall {
  id: string;
  tool: string;
  status: string;
  arguments: unknown;
  result: unknown;
  error: string | null;
}

export interface AiHistoryMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  model: string | null;
  status: string;
  error: string | null;
  costUsd: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  createdAt: string;
  toolCalls: AiHistoryToolCall[];
}

export interface AiHistoryDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  userName: string | null;
  messages: AiHistoryMessage[];
}

export interface AiHistoryQuota {
  settings: { enabled: boolean; amountUsd: number; resetDay: number; resetAt: string | null };
  periodStart: string;
  nextReset: string;
  users: { id: string; name: string; email: string; usageUsd: number; percent: number; unlimited: boolean }[];
}

export interface AiHistoryPurgePreview {
  conversations: number;
  messages: number;
  ledgerEntries: number;
}

export function aiHistoryParams(filters: AiHistoryFilters): URLSearchParams {
  const params = new URLSearchParams({ days: filters.days });
  if (filters.userIds.length) params.set("userIds", filters.userIds.join(","));
  if (filters.models.length) params.set("models", filters.models.join(","));
  return params;
}

export function useAiHistoryList(filters: AiHistoryFilters, page: number, limit: number, enabled: boolean) {
  const params = aiHistoryParams(filters);
  params.set("page", String(page));
  params.set("limit", String(limit));
  return useQuery({
    queryKey: ["ai-history", "list", filters, page, limit],
    queryFn: () => apiFetch<{ data: AiHistoryConversation[]; total: number; page: number; limit: number }>(`/api/ai-history?${params}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAiHistorySummary(filters: AiHistoryFilters, enabled: boolean) {
  return useQuery({
    queryKey: ["ai-history", "summary", filters],
    queryFn: () => apiFetch<AiHistorySummary>(`/api/ai-history/summary?${aiHistoryParams(filters)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAiHistoryFilterOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["ai-history", "filters"],
    queryFn: () => apiFetch<{ users: { id: string; name: string }[]; models: string[] }>("/api/ai-history/filters"),
    enabled,
  });
}

export function useAiHistoryQuota(enabled: boolean) {
  return useQuery({
    queryKey: ["ai-history", "quota"],
    queryFn: () => apiFetch<AiHistoryQuota>("/api/ai-history/quota"),
    enabled,
  });
}

export function useAiConversation(id: string | null) {
  return useQuery({
    queryKey: ["ai-history", "detail", id],
    queryFn: () => apiFetch<AiHistoryDetail>(`/api/ai-history/${id}`),
    enabled: !!id,
  });
}

export function previewAiHistoryPurge(before: string) {
  return apiFetch<AiHistoryPurgePreview>(`/api/ai-history/purge?${new URLSearchParams({ before })}`);
}

export function usePurgeAiHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (before: string) =>
      apiFetch<AiHistoryPurgePreview>("/api/ai-history/purge", { method: "DELETE", body: JSON.stringify({ before }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ai-history"] }),
  });
}
