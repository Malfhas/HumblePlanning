"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export interface BackupRecord {
  id: string;
  filename: string;
  sizeBytes: number;
  sizeCompressed: number | null;
  durationMs: number;
  status: "completed" | "failed" | "in_progress";
  errorMessage: string | null;
  triggerType: "manual" | "scheduled";
  userId: string | null;
  encrypted: boolean;
  createdAt: string;
  user?: { id: string; name: string; firstName: string | null } | null;
}

export interface BackupListResponse {
  items: BackupRecord[];
  total: number;
  page: number;
  limit: number;
  encryptionKeyConfigured: boolean;
}

export function useBackups(page = 1, limit = 20) {
  return useQuery({
    queryKey: ["backups", page, limit],
    queryFn: () => fetchApi<BackupListResponse>(`/api/backups?page=${page}&limit=${limit}`),
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchApi<BackupRecord>("/api/backups", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });
}

export function useDeleteBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/backups/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });
}

export function useDownloadBackup() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backups/${id}`);
      await throwIfNotOk(res);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? "backup.dump";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
