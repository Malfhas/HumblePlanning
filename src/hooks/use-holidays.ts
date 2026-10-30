"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Holiday } from "@/types";
import { apiFetch } from "@/lib/api-client";

export function useHolidays(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["holidays", startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      return apiFetch<Holiday[]>(`/api/holidays?${params}`);
    },
  });
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { date: string; label?: string; color?: string }) =>
      apiFetch("/api/holidays", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useUpdateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { date?: string; label?: string; color?: string } }) =>
      apiFetch(`/api/holidays/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useImportHolidays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { holidays: { date: string; label: string }[]; country?: string; year?: number }) =>
      apiFetch<{ imported: number; skipped: number }>("/api/holidays/import", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/holidays/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}
