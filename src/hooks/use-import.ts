"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";

/** Analysis of one dump table (`table`: SQL name, label translated at render time). */
export interface TableAnalysis {
  table: string;
  countInDump: number;
  countInLive: number;
  conflictCount: number;
}

export interface ImportAnalysis {
  tables: TableAnalysis[];
  totalInDump: number;
  totalConflicts: number;
  valid: boolean;
}

export interface ImportResult {
  success: boolean;
  mode: "merge" | "replace";
  inserted?: Record<string, number>;
  forceReload?: boolean;
}

export function useAnalyzeImport() {
  return useMutation({
    mutationFn: async (file: File): Promise<ImportAnalysis> => {
      // Send the file as a raw body (not FormData) — the Next.js FormData
      // parser fails on large dumps.
      const res = await fetch("/api/import/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      await throwIfNotOk(res);
      return res.json();
    },
  });
}

export function useExecuteImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mode: "merge" | "replace"): Promise<ImportResult> => {
      const res = await fetch("/api/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      await throwIfNotOk(res);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

export function useCleanupImport() {
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/import/cleanup", { method: "DELETE" });
    },
  });
}
