"use client";

import { create } from "zustand";

interface TaskPreviewState {
  taskId: string | null;
  open: boolean;
  openPreview: (taskId: string) => void;
  closePreview: () => void;
}

export const useTaskPreviewStore = create<TaskPreviewState>((set) => ({
  taskId: null,
  open: false,
  openPreview: (taskId) => set({ taskId, open: true }),
  closePreview: () => set({ open: false, taskId: null }),
}));
