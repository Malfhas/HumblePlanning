"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusinessUnit } from "@/types";
import { throwIfNotOk } from "@/lib/api-client";

/** Throws an `ApiClientError` (translated message, status, code, fields) on failure. */
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useBusinessUnits(unscoped = false) {
  return useQuery({
    queryKey: ["business-units", unscoped],
    queryFn: () => fetchApi<BusinessUnit[]>(`/api/business-units${unscoped ? "?unscoped=true" : ""}`),
  });
}

export function useBusinessUnit(id: string | null) {
  return useQuery({
    queryKey: ["business-units", id],
    queryFn: () => fetchApi<BusinessUnit>(`/api/business-units/${id}`),
    enabled: !!id,
  });
}

export function useCreateBusinessUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<BusinessUnit>) => fetchApi("/api/business-units", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business-units"] }),
  });
}

export function useUpdateBusinessUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BusinessUnit> }) =>
      fetchApi(`/api/business-units/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business-units"] }),
  });
}

export function useDeleteBusinessUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/business-units/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business-units"] }),
  });
}
