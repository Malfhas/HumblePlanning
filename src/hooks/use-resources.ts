"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { ResourceWithType } from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useResources(includeOutOfService = true) {
  return useQuery({
    queryKey: ["resources", includeOutOfService],
    queryFn: () => fetchApi<ResourceWithType[]>(`/api/resources?includeOutOfService=${includeOutOfService}`),
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      fetchApi("/api/resources", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resources"] }),
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      fetchApi(`/api/resources/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resources"] }),
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/resources/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resources"] }),
  });
}
