"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { WheelEvent } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { useFilterStore } from "@/stores/filter-store";
import { useTeams } from "@/hooks/use-teams";
import { useUsers } from "@/hooks/use-users";
import { useProjects } from "@/hooks/use-projects";
import { useStatuses } from "@/hooks/use-statuses";
import { useResources } from "@/hooks/use-resources";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { useVehicles } from "@/hooks/use-vehicles";
import { useQualifications } from "@/hooks/use-qualifications";
import { useGroups } from "@/hooks/use-groups";
import { useSavedFilters, useCreateFilter, useDeleteFilter } from "@/hooks/use-filters";
import { usePermissions } from "@/hooks/use-permissions";
import { useBuStore } from "@/stores/bu-store";
import { Save, Trash2, X, ChevronsUpDown, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { cn, formatProjectName } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { SavedFilter, FilterConfig } from "@/types";

interface FilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FilterItem {
  id: string;
  name: string;
  color?: string | null;
  emoji?: string | null;
}

interface FilterGroup {
  label: string;
  items: FilterItem[];
}

interface FilterSearchableMultiSelectProps {
  label: string;
  items: FilterItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  groups?: FilterGroup[];
}

function FilterSearchableMultiSelect({ label, items, selected, onChange, placeholder, groups }: FilterSearchableMultiSelectProps) {
  const t = useTranslations("planning.filters");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);

  // Scroll fix: prevent wheel events from leaking to Sheet scroll lock
  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
  }, []);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const allItems = groups ? groups.flatMap((g) => g.items) : items;

  const selectedNames = useMemo(() => {
    if (selected.length === 0) return "";
    if (selected.length <= 2) {
      return allItems.filter(i => selected.includes(i.id)).map(i => i.name).join(", ");
    }
    return t("selectedCount", { count: selected.length });
  }, [selected, allItems, t]);

  const renderItem = (item: FilterItem) => (
    <CommandItem
      key={item.id}
      value={item.id}
      keywords={[item.name]}
      onSelect={() => toggle(item.id)}
    >
      <Checkbox
        checked={selected.includes(item.id)}
        className="mr-2 pointer-events-none"
      />
      {item.emoji && <span className="mr-1.5">{item.emoji}</span>}
      {item.color && !item.emoji && (
        <span
          className="mr-1.5 h-2.5 w-2.5 rounded-full shrink-0 inline-block"
          style={{ backgroundColor: item.color }}
        />
      )}
      <span className="truncate">{item.name}</span>
      {selected.includes(item.id) && !item.emoji && (
        <Check className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
      )}
    </CommandItem>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-200 transition-colors dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50"
            title={t("clearFilter")}
          >
            {selected.length}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between font-normal", !selected.length && "text-muted-foreground")}
            size="sm"
          >
            <span className="truncate">
              {selectedNames || placeholder || t("selectPlaceholder")}
            </span>
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
          <Command>
            <CommandInput placeholder={tc("actions.searchPlaceholder")} />
            <CommandList className="overscroll-contain" onWheel={handleWheel}>
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {groups ? (
                groups.map((group) => (
                  <CommandGroup key={group.label} heading={group.label}>
                    {group.items.map(renderItem)}
                  </CommandGroup>
                ))
              ) : (
                <CommandGroup>
                  {items.map(renderItem)}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function FilterPanel({ open, onOpenChange }: FilterPanelProps) {
  // Lazy mount: the panel's 11 useQuery calls (teams, users,
  // projects, statuses, resources, businessUnits, vehicles, qualifications,
  // groups, savedFilters + meta) only load on the FIRST opening of the panel.
  // If the user never uses the filters, this saves 11
  // round-trips when /planning mounts (+ frees bandwidth
  // for /api/tasks, which blocks rendering).
  // Once mounted, the content stays mounted to preserve the state
  // (selections, scroll, Sheet animation) between openings.
  const [hasBeenOpened, setHasBeenOpened] = useState(open);
  useEffect(() => {
    if (open && !hasBeenOpened) setHasBeenOpened(true);
  }, [open, hasBeenOpened]);
  if (!hasBeenOpened) return null;

  return <FilterPanelInner open={open} onOpenChange={onOpenChange} />;
}

function FilterPanelInner({ open, onOpenChange }: FilterPanelProps) {
  const t = useTranslations("planning.filters");
  const tCommon = useTranslations("common");
  const filters = useFilterStore();
  const { data: teams } = useTeams();
  const { data: users } = useUsers(undefined, false);
  const { data: projects } = useProjects();
  const { data: statuses } = useStatuses();
  const { data: resources } = useResources();
  const { data: businessUnits } = useBusinessUnits();
  const { data: vehicles } = useVehicles();
  const { data: qualifications } = useQualifications();
  const { data: groups } = useGroups();
  const { data: savedFilters } = useSavedFilters();
  const createFilter = useCreateFilter();
  const deleteFilter = useDeleteFilter();

  const { userId, user, userScope, projectScope } = usePermissions();
  const { selectedBuIds } = useBuStore();

  // Helper: check if an entity belongs to any of the selected BUs.
  // If no BU selected in header → everything passes (no filter).
  const matchesBu = useCallback((buId: string | null | undefined) => {
    if (selectedBuIds.length === 0) return true; // "All BUs"
    if (!buId) return false; // entity has no BU → hidden when specific BU selected
    return selectedBuIds.includes(buId);
  }, [selectedBuIds]);

  const filteredTeams = useMemo(() => {
    if (!teams) return [];
    let result = teams as any[];
    // If user can only see their team, filter teams
    if (userScope === "team") {
      const myTeamId = user?.teamId;
      if (myTeamId) result = result.filter((t: any) => t.id === myTeamId);
    }
    // BU filter: show team if at least 1 member belongs to a selected BU
    if (selectedBuIds.length > 0 && users) {
      const usersInBu = new Set(
        (users as any[]).filter((u: any) => matchesBu(u.businessUnitId || u.businessUnit?.id)).map((u: any) => u.teamId)
      );
      result = result.filter((t: any) => usersInBu.has(t.id));
    }
    return result;
  }, [teams, userScope, user, selectedBuIds, users, matchesBu]);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    // Hide users not visible on planning (except current user who always sees themselves)
    let result = (users as any[]).filter((u: any) => u.visibleOnPlanning || u.id === userId);
    if (userScope === "self") {
      result = result.filter((u: any) => u.id === userId);
    } else if (userScope === "team") {
      const myTeamId = user?.teamId;
      if (myTeamId) result = result.filter((u: any) => u.teamId === myTeamId);
    } else if (userScope === "bu") {
      const myBuId = (user as any)?.businessUnitId ?? (user as any)?.businessUnit?.id;
      if (myBuId) result = result.filter((u: any) => u.businessUnitId === myBuId || u.businessUnit?.id === myBuId);
    }
    // If teams are filtered, only show users from those teams
    if (filters.teamIds.length > 0) {
      result = result.filter((u: any) => u.teamId && filters.teamIds.includes(u.teamId));
    }
    // BU header filter
    if (selectedBuIds.length > 0) {
      result = result.filter((u: any) => matchesBu(u.businessUnitId || u.businessUnit?.id));
    }
    return result;
  }, [users, userScope, userId, user, filters.teamIds, selectedBuIds, matchesBu]);

  const filteredBusinessUnits = useMemo(() => {
    if (!businessUnits) return [];
    // Project scope "bu" → only show the user's BU
    if (projectScope === "bu") {
      const myBuId = (user as any)?.businessUnitId ?? (user as any)?.businessUnit?.id;
      if (myBuId) return businessUnits.filter((b: any) => b.id === myBuId);
    }
    // BU header filter: restrict to selected BUs
    if (selectedBuIds.length > 0) {
      return businessUnits.filter((b: any) => selectedBuIds.includes(b.id));
    }
    return businessUnits;
  }, [businessUnits, projectScope, user, selectedBuIds]);

  // Group users by team
  const userGroups = useMemo<FilterGroup[]>(() => {
    if (!filteredUsers.length) return [];
    const byTeam = new Map<string, FilterItem[]>();
    const noTeam: FilterItem[] = [];
    for (const u of filteredUsers) {
      const item: FilterItem = { id: u.id, name: [(u as any).firstName, u.name].filter(Boolean).join(" "), color: u.color };
      const teamName = (u as any).team?.name || (u as any).teamName;
      if (teamName) {
        if (!byTeam.has(teamName)) byTeam.set(teamName, []);
        byTeam.get(teamName)!.push(item);
      } else {
        noTeam.push(item);
      }
    }
    const result: FilterGroup[] = [];
    for (const [teamName, items] of byTeam) {
      result.push({ label: teamName, items });
    }
    if (noTeam.length > 0) {
      result.push({ label: t("noTeam"), items: noTeam });
    }
    return result;
  }, [filteredUsers, t]);

  // Filter projects by selected groups + BU header
  const filteredProjects = useMemo(() => {
    let result = (projects ?? []) as any[];
    // BU header filter
    if (selectedBuIds.length > 0) {
      result = result.filter((p: any) => matchesBu(p.businessUnitId || p.businessUnit?.id));
    }
    // Group filter
    if (filters.groupIds.length > 0) {
      result = result.filter((p: any) => p.group?.id && filters.groupIds.includes(p.group.id));
    }
    return result;
  }, [projects, filters.groupIds, selectedBuIds, matchesBu]);

  // Group projects by project group
  const projectGroupsList = useMemo<FilterGroup[]>(() => {
    if (!filteredProjects.length) return [];
    const byGroup = new Map<string, FilterItem[]>();
    const noGroup: FilterItem[] = [];
    for (const p of filteredProjects) {
      const item: FilterItem = { id: p.id, name: formatProjectName(p), color: p.color };
      const groupName = (p as any).group?.name;
      if (groupName) {
        if (!byGroup.has(groupName)) byGroup.set(groupName, []);
        byGroup.get(groupName)!.push(item);
      } else {
        noGroup.push(item);
      }
    }
    const result: FilterGroup[] = [];
    for (const [groupName, items] of byGroup) {
      result.push({ label: groupName, items });
    }
    if (noGroup.length > 0) {
      result.push({ label: t("noGroup"), items: noGroup });
    }
    return result;
  }, [filteredProjects, t]);

  // Filter groups: show only groups that have at least 1 project in the selected BU(s)
  const filteredGroupItems = useMemo(() => {
    if (!groups) return [];
    let result = groups as any[];
    if (selectedBuIds.length > 0) {
      const allProjects = (projects ?? []) as any[];
      const groupIdsWithBuProject = new Set(
        allProjects
          .filter((p: any) => matchesBu(p.businessUnitId || p.businessUnit?.id))
          .map((p: any) => p.group?.id || p.groupId)
          .filter(Boolean)
      );
      result = result.filter((g: any) => groupIdsWithBuProject.has(g.id));
    }
    return result.map((g: any) => ({ id: g.id, name: g.name, color: g.color }));
  }, [groups, projects, selectedBuIds, matchesBu]);

  // Filter vehicles by BU
  const filteredVehicleItems = useMemo(() => {
    let result = (vehicles ?? []) as any[];
    if (selectedBuIds.length > 0) {
      result = result.filter((v: any) => matchesBu(v.businessUnitId || v.businessUnit?.id));
    }
    return result.map((v: any) => ({ id: v.id, name: v.name, color: v.color }));
  }, [vehicles, selectedBuIds, matchesBu]);

  // Filter resources by BU
  const filteredResourceItems = useMemo(() => {
    let result = (resources ?? []) as any[];
    if (selectedBuIds.length > 0) {
      result = result.filter((r: any) => matchesBu(r.businessUnitId || r.businessUnit?.id));
    }
    return result.map((r: any) => ({ id: r.id, name: r.name, color: r.color }));
  }, [resources, selectedBuIds, matchesBu]);

  const [filterName, setFilterName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleSave = () => {
    if (!filterName.trim()) return;
    createFilter.mutate({
      name: filterName.trim(),
      module: "planning",
      filters: {
        teamIds: filters.teamIds.length > 0 ? filters.teamIds : undefined,
        userIds: filters.userIds.length > 0 ? filters.userIds : undefined,
        projectIds: filters.projectIds.length > 0 ? filters.projectIds : undefined,
        statusIds: filters.statusIds.length > 0 ? filters.statusIds : undefined,
        businessUnitIds: filters.businessUnitIds.length > 0 ? filters.businessUnitIds : undefined,
        siteAddressIds: filters.siteAddressIds.length > 0 ? filters.siteAddressIds : undefined,
        resourceIds: filters.resourceIds.length > 0 ? filters.resourceIds : undefined,
        vehicleIds: filters.vehicleIds.length > 0 ? filters.vehicleIds : undefined,
        qualificationIds: filters.qualificationIds.length > 0 ? filters.qualificationIds : undefined,
        groupIds: filters.groupIds.length > 0 ? filters.groupIds : undefined,
        search: filters.search || undefined,
      },
    }, { onSuccess: () => setFilterName("") });
  };

  const handleLoadFilter = (filter: SavedFilter) => {
    const f = filter.filters as any;
    filters.applyFilter({
      teamIds: f.teamIds || [],
      userIds: f.userIds || [],
      projectIds: f.projectIds || [],
      statusIds: f.statusIds || [],
      businessUnitIds: f.businessUnitIds || [],
      siteAddressIds: f.siteAddressIds || [],
      resourceIds: f.resourceIds || [],
      vehicleIds: f.vehicleIds || [],
      qualificationIds: f.qualificationIds || [],
      groupIds: f.groupIds || [],
      search: f.search || "",
    });
  };

  const activeCount = [
    filters.teamIds.length,
    filters.userIds.length,
    filters.projectIds.length,
    filters.statusIds.length,
    filters.businessUnitIds.length,
    filters.siteAddressIds.length,
    filters.resourceIds.length,
    filters.vehicleIds.length,
    filters.qualificationIds.length,
    filters.groupIds.length,
    filters.search ? 1 : 0,
  ].reduce((a, b) => a + (b > 0 ? 1 : 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[580px] sm:max-w-[580px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {t("title")}
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-2">{t("activeCount", { count: activeCount })}</Badge>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("description")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t("search.label")}</Label>
            <Input
              placeholder={t("search.placeholder")}
              value={filters.search}
              onChange={(e) => filters.setSearch(e.target.value)}
            />
          </div>

          <FilterSearchableMultiSelect
            label={tCommon("entities.businessUnits")}
            items={filteredBusinessUnits.map((bu: any) => ({
              id: bu.id,
              name: `${bu.name} — ${bu.address}`,
            }))}
            selected={filters.businessUnitIds}
            onChange={filters.setBusinessUnitIds}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.teams")}
            items={filteredTeams.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            selected={filters.teamIds}
            onChange={filters.setTeamIds}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.users")}
            items={filteredUsers.map((u) => ({ id: u.id, name: [(u as any).firstName, u.name].filter(Boolean).join(" "), color: u.color }))}
            selected={filters.userIds}
            onChange={filters.setUserIds}
            groups={userGroups.length > 1 ? userGroups : undefined}
          />

          <FilterSearchableMultiSelect
            label={t("projectGroups")}
            items={filteredGroupItems}
            selected={filters.groupIds}
            onChange={filters.setGroupIds}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.projects")}
            items={filteredProjects.map((p) => ({ id: p.id, name: formatProjectName(p), color: p.color }))}
            selected={filters.projectIds}
            onChange={filters.setProjectIds}
            groups={projectGroupsList.length > 1 ? projectGroupsList : undefined}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.statuses")}
            items={(statuses ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color }))}
            selected={filters.statusIds}
            onChange={filters.setStatusIds}
          />

          <FilterSearchableMultiSelect
            label={t("siteAddresses")}
            items={filteredProjects.filter((p: any) => p.address).map((p: any) => ({
              id: p.id,
              name: `${formatProjectName(p)} — ${p.address}`,
              color: p.color,
            }))}
            selected={filters.siteAddressIds}
            onChange={filters.setSiteAddressIds}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.resources")}
            items={filteredResourceItems}
            selected={filters.resourceIds}
            onChange={filters.setResourceIds}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.vehicles")}
            items={filteredVehicleItems}
            selected={filters.vehicleIds}
            onChange={filters.setVehicleIds}
          />

          <FilterSearchableMultiSelect
            label={tCommon("entities.qualifications")}
            items={(qualifications ?? []).map((q) => ({ id: q.id, name: q.name, color: q.color }))}
            selected={filters.qualificationIds}
            onChange={filters.setQualificationIds}
          />

          {/* Saved filters */}
          {savedFilters && savedFilters.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <Label className="text-sm font-medium">{t("saved.title")}</Label>
              <div className="space-y-1">
                {savedFilters.map((sf) => (
                  <div key={sf.id} className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 justify-start text-sm h-8"
                      onClick={() => handleLoadFilter(sf)}
                    >
                      {sf.name}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setDeleteTarget({ id: sf.id, name: sf.name })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{tCommon("actions.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save current filter */}
          <div className="space-y-2 border-t pt-4">
            <Label className="text-sm font-medium">{t("saved.saveCurrent")}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={t("saved.namePlaceholder")}
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                className="h-8"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleSave}
                disabled={!filterName.trim() || createFilter.isPending}
                className="h-8"
                aria-label={t("saved.saveAriaLabel")}
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" size="sm" onClick={() => filters.clearAll()}>
            <X className="mr-1 h-3.5 w-3.5" /> {tCommon("actions.reset")}
          </Button>
        </SheetFooter>
      </SheetContent>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("saved.deleteTitle")}
        description={t("saved.deleteDescription", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteFilter.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
        isPending={deleteFilter.isPending}
      />
    </Sheet>
  );
}
