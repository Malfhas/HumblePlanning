"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { FileFilters } from "@/lib/validators/file";
import { apiFetch } from "@/lib/api-client";

export interface FileEntry {
  fileId: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string | null;
  taskId: string;
  taskTitle: string | null;
  projectId: string;
  projectName: string | null;
  projectColor: string | null;
  uploaderName: string | null;
}

export function useAllFiles(filters: Partial<FileFilters>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  });

  return useQuery({
    queryKey: ["files", filters],
    queryFn: () =>
      apiFetch<{ data: FileEntry[]; total: number; page: number; limit: number }>(
        `/api/files?${params}`
      ),
    staleTime: 0,
    gcTime: 0,
  });
}

export function usePurgeFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (before: string) =>
      apiFetch<{ deleted: number }>("/api/files/purge", {
        method: "DELETE",
        body: JSON.stringify({ before }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["storage-stats"] });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, fileId }: { taskId: string; fileId: string }) =>
      apiFetch(`/api/tasks/${taskId}/files?fileId=${fileId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["storage-stats"] });
    },
  });
}
