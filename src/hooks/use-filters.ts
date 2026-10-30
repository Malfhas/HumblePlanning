"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateSavedFilter, UpdateSavedFilter } from "@/lib/validators/filter";
import type { SavedFilter } from "@/types";
import { apiFetch } from "@/lib/api-client";

export function useSavedFilters() {
  return useQuery({
    queryKey: ["filters"],
    queryFn: () => apiFetch<SavedFilter[]>("/api/filters"),
  });
}

export function useCreateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSavedFilter) =>
      apiFetch("/api/filters", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
}

export function useUpdateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSavedFilter }) =>
      apiFetch(`/api/filters/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/filters/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
}
