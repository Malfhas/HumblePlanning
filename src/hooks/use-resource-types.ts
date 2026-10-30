"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useResourceTypes() {
  return useQuery({ queryKey: ["resource-types"], queryFn: () => fetchApi<any[]>("/api/resource-types") });
}

export function useCreateResourceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => fetchApi("/api/resource-types", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resource-types"] }),
  });
}

export function useUpdateResourceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      fetchApi(`/api/resource-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resource-types"] }),
  });
}

export function useDeleteResourceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/resource-types/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resource-types"] }),
  });
}
