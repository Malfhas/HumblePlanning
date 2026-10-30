"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { VehicleType } from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useVehicleTypes() {
  return useQuery({
    queryKey: ["vehicle-types"],
    queryFn: () => fetchApi<VehicleType[]>("/api/vehicle-types"),
  });
}

export function useCreateVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; icon?: string; color?: string; sortOrder?: number }) =>
      fetchApi("/api/vehicle-types", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle-types"] }),
  });
}

export function useUpdateVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; icon?: string; color?: string; sortOrder?: number } }) =>
      fetchApi(`/api/vehicle-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle-types"] }),
  });
}

export function useDeleteVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/vehicle-types/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle-types"] }),
  });
}
