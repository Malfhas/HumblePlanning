"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BuStoreState {
  /** Selected BU IDs. Empty array = "All BUs" (no filter). */
  selectedBuIds: string[];
  _initialized: boolean;
  /** `false` until Zustand has finished reading localStorage.
   *  Critical consumers (e.g. tasksQuery) must disable their fetch
   *  while this flag is `false`, otherwise they fire a request with
   *  `selectedBuIds: []` (initial value) that is immediately replaced
   *  by the real hydrated value → 2 fetches, one of them useless
   *  and heavy. */
  _hasHydrated: boolean;
  setSelectedBus: (ids: string[]) => void;
  toggleBu: (id: string) => void;
  selectAll: () => void;
  initialize: (userBuId: string | null) => void;
  setHasHydrated: (v: boolean) => void;
}

export const useBuStore = create<BuStoreState>()(
  persist(
    (set, get) => ({
      selectedBuIds: [],
      _initialized: false,
      _hasHydrated: false,
      setSelectedBus: (ids) => set({ selectedBuIds: ids }),
      toggleBu: (id) => {
        const current = get().selectedBuIds;
        if (current.includes(id)) {
          set({ selectedBuIds: current.filter((x) => x !== id) });
        } else {
          set({ selectedBuIds: [...current, id] });
        }
      },
      selectAll: () => set({ selectedBuIds: [] }),
      initialize: (userBuId) => {
        if (!get()._initialized) {
          set({ selectedBuIds: userBuId ? [userBuId] : [], _initialized: true });
        }
      },
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: "bu-selector",
      partialize: (state) => ({
        selectedBuIds: state.selectedBuIds,
        _initialized: state._initialized,
        // `_hasHydrated` deliberately EXCLUDED from partialize: it must
        // start as `false` on every load and switch to `true`
        // only through `onRehydrateStorage` below.
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
