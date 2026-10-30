"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FilterState {
  teamIds: string[];
  userIds: string[];
  projectIds: string[];
  statusIds: string[];
  businessUnitIds: string[];
  siteAddressIds: string[];
  resourceIds: string[];
  vehicleIds: string[];
  qualificationIds: string[];
  groupIds: string[];
  search: string;

  setTeamIds: (ids: string[]) => void;
  setUserIds: (ids: string[]) => void;
  setProjectIds: (ids: string[]) => void;
  setStatusIds: (ids: string[]) => void;
  setBusinessUnitIds: (ids: string[]) => void;
  setSiteAddressIds: (ids: string[]) => void;
  setResourceIds: (ids: string[]) => void;
  setVehicleIds: (ids: string[]) => void;
  setQualificationIds: (ids: string[]) => void;
  setGroupIds: (ids: string[]) => void;
  setSearch: (search: string) => void;
  clearAll: () => void;
  applyFilter: (filters: Partial<Pick<FilterState, "teamIds" | "userIds" | "projectIds" | "statusIds" | "businessUnitIds" | "siteAddressIds" | "resourceIds" | "vehicleIds" | "qualificationIds" | "groupIds" | "search">>) => void;
  hasActiveFilters: () => boolean;
  /** `false` until Zustand has finished reading localStorage.
   *  See bu-store.ts for the rationale (avoids an initial fetch with
   *  empty filters followed by a 2nd fetch with the real values). */
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      teamIds: [],
      userIds: [],
      projectIds: [],
      statusIds: [],
      businessUnitIds: [],
      siteAddressIds: [],
      resourceIds: [],
      vehicleIds: [],
      qualificationIds: [],
      groupIds: [],
      search: "",

      setTeamIds: (ids) => set({ teamIds: ids }),
      setUserIds: (ids) => set({ userIds: ids }),
      setProjectIds: (ids) => set({ projectIds: ids }),
      setStatusIds: (ids) => set({ statusIds: ids }),
      setBusinessUnitIds: (ids) => set({ businessUnitIds: ids }),
      setSiteAddressIds: (ids) => set({ siteAddressIds: ids }),
      setResourceIds: (ids) => set({ resourceIds: ids }),
      setVehicleIds: (ids) => set({ vehicleIds: ids }),
      setQualificationIds: (ids) => set({ qualificationIds: ids }),
      setGroupIds: (ids) => set({ groupIds: ids }),
      setSearch: (search) => set({ search }),

      clearAll: () =>
        set({ teamIds: [], userIds: [], projectIds: [], statusIds: [], businessUnitIds: [], siteAddressIds: [], resourceIds: [], vehicleIds: [], qualificationIds: [], groupIds: [], search: "" }),

      applyFilter: (filters) => set(filters),

      hasActiveFilters: () => {
        const s = get();
        return (
          s.teamIds.length > 0 ||
          s.userIds.length > 0 ||
          s.projectIds.length > 0 ||
          s.statusIds.length > 0 ||
          s.businessUnitIds.length > 0 ||
          s.siteAddressIds.length > 0 ||
          s.resourceIds.length > 0 ||
          s.vehicleIds.length > 0 ||
          s.qualificationIds.length > 0 ||
          s.groupIds.length > 0 ||
          s.search.length > 0
        );
      },

      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: "planning-filters",
      partialize: (state) => ({
        teamIds: state.teamIds,
        userIds: state.userIds,
        projectIds: state.projectIds,
        statusIds: state.statusIds,
        businessUnitIds: state.businessUnitIds,
        siteAddressIds: state.siteAddressIds,
        resourceIds: state.resourceIds,
        vehicleIds: state.vehicleIds,
        qualificationIds: state.qualificationIds,
        groupIds: state.groupIds,
        search: state.search,
        // `_hasHydrated` excluded: starts false on every load.
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
