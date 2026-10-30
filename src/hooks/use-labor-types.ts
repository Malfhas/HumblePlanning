"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { LaborType } from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useLaborTypes() {
  return useQuery({ queryKey: ["labor-types"], queryFn: () => fetchApi<LaborType[]>("/api/labor-types") });
}

export function useCreateLaborType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<LaborType>) => fetchApi("/api/labor-types", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labor-types"] }),
  });
}

export function useUpdateLaborType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LaborType> }) =>
      fetchApi(`/api/labor-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labor-types"] }),
  });
}

export function useDeleteLaborType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/labor-types/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labor-types"] }),
  });
}
