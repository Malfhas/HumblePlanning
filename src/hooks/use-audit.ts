"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuditFilters } from "@/lib/validators/audit";
import { apiFetch } from "@/lib/api-client";

export function useAuditLogs(filters: Partial<AuditFilters>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  });

  return useQuery({
    queryKey: ["audit", filters],
    queryFn: () =>
      apiFetch<{ data: AuditLog[]; entityNames: Record<string, string>; total: number; page: number; limit: number }>(
        `/api/audit?${params}`
      ),
  });
}

export function useRestoreAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/audit/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function usePurgeAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (before: string) =>
      apiFetch("/api/audit/purge", {
        method: "DELETE",
        body: JSON.stringify({ before }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

// Type for audit log entries
export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  changeCount: number | null;
  user: { id: string; name: string | null } | null;
}
