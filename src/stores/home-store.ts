"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface HomeState {
  showCollaborators: boolean;
  toggleCollaborators: () => void;
  setShowCollaborators: (value: boolean) => void;
}

export const useHomeStore = create<HomeState>()(
  persist(
    (set) => ({
      showCollaborators: true,
      toggleCollaborators: () => set((s) => ({ showCollaborators: !s.showCollaborators })),
      setShowCollaborators: (value) => set({ showCollaborators: value }),
    }),
    {
      name: "home-preferences",
      partialize: (state) => ({ showCollaborators: state.showCollaborators }),
    },
  ),
);
