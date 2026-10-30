"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Qualification } from "@/types";
import { throwIfNotOk } from "@/lib/api-client";

/** Throws an `ApiClientError` (translated message, status, code, fields) on failure. */
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useQualifications() {
  return useQuery({
    queryKey: ["qualifications"],
    queryFn: () => fetchApi<Qualification[]>("/api/qualifications"),
  });
}

export function useCreateQualification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; emoji?: string; color?: string; description?: string | null }) =>
      fetchApi("/api/qualifications", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qualifications"] }),
  });
}

export function useUpdateQualification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; emoji?: string; color?: string; description?: string | null } }) =>
      fetchApi(`/api/qualifications/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qualifications"] }),
  });
}

export function useDeleteQualification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/qualifications/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qualifications"] }),
  });
}
