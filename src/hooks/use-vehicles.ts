"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { VehicleWithType } from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useVehicles(includeOutOfService = true) {
  return useQuery({
    queryKey: ["vehicles", includeOutOfService],
    queryFn: () => fetchApi<VehicleWithType[]>(`/api/vehicles?includeOutOfService=${includeOutOfService}`),
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      vehicleTypeId?: string | null;
      registrationNumber?: string | null;
      color?: string;
      status?: string;
      comment?: string | null;
    }) =>
      fetchApi("/api/vehicles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: {
      id: string;
      data: {
        name?: string;
        vehicleTypeId?: string | null;
        registrationNumber?: string | null;
        color?: string;
        status?: string;
        comment?: string | null;
      };
    }) =>
      fetchApi(`/api/vehicles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/vehicles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}
