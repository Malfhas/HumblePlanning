import type { SortMode, ViewMode } from "@/lib/types/planning";

export type PlanningRow = {
  id: string;
  name: string;
  type: "row";
  teamId?: string | null;
  teamName?: string | null;
  teamColor?: string | null;
  teamSortOrder?: number;
  groupId?: string | null;
  groupName?: string | null;
  groupColor?: string | null;
  groupSortOrder?: number;
  sortOrder?: number;
  businessUnitId?: string | null;
  businessUnitName?: string | null;
  businessUnitColor?: string | null;
  vehicleTypeId?: string | null;
  vehicleTypeName?: string | null;
  vehicleTypeColor?: string | null;
  resourceTypeId?: string | null;
  resourceTypeName?: string | null;
  resourceTypeColor?: string | null;
  [key: string]: unknown;
};

export type HeaderRow = {
  id: string;
  name: string;
  color: string;
  type: "header";
};

export type GridRow = PlanningRow | HeaderRow;

/** Group header labels for rows without a team / group / type / business unit. */
export interface NoneGroupLabels {
  noTeam: string;
  noGroup: string;
  noType: string;
  noBu: string;
}

export interface SortRowsOptions {
  /** Translated labels (client: `planning.rows.*`, server: `exportFiles`). */
  labels: NoneGroupLabels;
  /** BCP 47 tag used for sorting (`INTL_TAG[locale]`). */
  collatorLocale: string;
}

export function sortAndGroupRows(
  rows: PlanningRow[],
  sortMode: SortMode,
  _viewMode: ViewMode,
  options: SortRowsOptions,
): GridRow[] {
  const collator = new Intl.Collator(options.collatorLocale, { sensitivity: "base" });
  const cmp = (a: string, b: string): number => collator.compare(a, b);
  const L = options.labels;
  switch (sortMode) {
    case "name-asc":
      return [...rows].sort((a, b) => cmp(a.name, b.name));

    case "name-desc":
      return [...rows].sort((a, b) => cmp(b.name, a.name));

    case "team-name-asc":
    case "team-name-desc": {
      const desc = sortMode === "team-name-desc";
      const groups = groupBy(rows, (r) => r.teamId ?? "__none__");
      const entries = Object.entries(groups);

      // Sort groups by team name, "no team" last
      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = groups[keyA][0]?.teamName ?? "";
        const nameB = groups[keyB][0]?.teamName ?? "";
        return desc ? cmp(nameB, nameA) : cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const teamName = key === "__none__" ? L.noTeam : (members[0]?.teamName ?? "");
        const teamColor = key === "__none__" ? "#94a3b8" : (members[0]?.teamColor ?? "#3b82f6");
        result.push({ id: `header-team-${key}`, name: teamName, color: teamColor, type: "header" });
        members.sort((a, b) => cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    case "group-name-asc":
    case "group-name-desc": {
      const desc = sortMode === "group-name-desc";
      const groups = groupBy(rows, (r) => r.groupId ?? "__none__");
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = groups[keyA][0]?.groupName ?? "";
        const nameB = groups[keyB][0]?.groupName ?? "";
        return desc ? cmp(nameB, nameA) : cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const groupName = key === "__none__" ? L.noGroup : (members[0]?.groupName ?? "");
        const groupColor = key === "__none__" ? "#94a3b8" : (members[0]?.groupColor ?? "#6366f1");
        result.push({ id: `header-group-${key}`, name: groupName, color: groupColor, type: "header" });
        members.sort((a, b) => cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    case "type-name-asc":
    case "type-name-desc": {
      const desc = sortMode === "type-name-desc";
      const isResource = _viewMode === "resources";
      const getTypeId = (r: PlanningRow) => (isResource ? r.resourceTypeId : r.vehicleTypeId) ?? "__none__";
      const getTypeName = (r: PlanningRow) => (isResource ? r.resourceTypeName : r.vehicleTypeName) ?? "";
      const getTypeColor = (r: PlanningRow) => (isResource ? r.resourceTypeColor : r.vehicleTypeColor) ?? "#3b82f6";

      const groups = groupBy(rows, getTypeId);
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = getTypeName(groups[keyA][0]);
        const nameB = getTypeName(groups[keyB][0]);
        return desc ? cmp(nameB, nameA) : cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const typeName = key === "__none__" ? L.noType : getTypeName(members[0]);
        const typeColor = key === "__none__" ? "#94a3b8" : getTypeColor(members[0]);
        result.push({ id: `header-type-${key}`, name: typeName, color: typeColor, type: "header" });
        members.sort((a, b) => cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    case "custom-group": {
      const groups = groupBy(rows, (r) => r.groupId ?? "__none__");
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const orderA = groups[keyA][0]?.groupSortOrder ?? 0;
        const orderB = groups[keyB][0]?.groupSortOrder ?? 0;
        return orderA - orderB || cmp(groups[keyA][0]?.groupName ?? "", groups[keyB][0]?.groupName ?? "");
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const groupName = key === "__none__" ? L.noGroup : (members[0]?.groupName ?? "");
        const groupColor = key === "__none__" ? "#94a3b8" : (members[0]?.groupColor ?? "#6366f1");
        result.push({ id: `header-group-${key}`, name: groupName, color: groupColor, type: "header" });
        members.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    case "custom-bu": {
      const groups = groupBy(rows, (r) => r.businessUnitId ?? "__none__");
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = groups[keyA][0]?.businessUnitName ?? "";
        const nameB = groups[keyB][0]?.businessUnitName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const buName = key === "__none__" ? L.noBu : (members[0]?.businessUnitName ?? "");
        const buColor = key === "__none__" ? "#94a3b8" : (members[0]?.businessUnitColor ?? "#8b5cf6");
        result.push({ id: `header-bu-${key}`, name: buName, color: buColor, type: "header" });
        members.sort((a, b) => cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    case "custom-bu-team": {
      const buGroups = groupBy(rows, (r) => r.businessUnitId ?? "__none__");
      const buEntries = Object.entries(buGroups);

      buEntries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = buGroups[keyA][0]?.businessUnitName ?? "";
        const nameB = buGroups[keyB][0]?.businessUnitName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [buKey, buMembers] of buEntries) {
        const buName = buKey === "__none__" ? L.noBu : (buMembers[0]?.businessUnitName ?? "");
        const buColor = buKey === "__none__" ? "#94a3b8" : (buMembers[0]?.businessUnitColor ?? "#8b5cf6");
        result.push({ id: `header-bu-${buKey}`, name: buName, color: buColor, type: "header" });

        // Sub-group by team
        const teamGroups = groupBy(buMembers, (r) => r.teamId ?? "__none__");
        const teamEntries = Object.entries(teamGroups);
        teamEntries.sort(([kA], [kB]) => {
          if (kA === "__none__") return 1;
          if (kB === "__none__") return -1;
          return cmp(teamGroups[kA][0]?.teamName ?? "", teamGroups[kB][0]?.teamName ?? "");
        });

        for (const [teamKey, teamMembers] of teamEntries) {
          const teamName = teamKey === "__none__" ? L.noTeam : (teamMembers[0]?.teamName ?? "");
          const teamColor = teamKey === "__none__" ? "#94a3b8" : (teamMembers[0]?.teamColor ?? "#3b82f6");
          result.push({ id: `header-bu-${buKey}-team-${teamKey}`, name: `  ${teamName}`, color: teamColor, type: "header" });
          teamMembers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
          result.push(...teamMembers);
        }
      }
      return result;
    }

    // NEW default: teams ordered by drag-drop on /teams (teams.sort_order),
    // members ordered by drag-drop inside each team.
    case "custom": {
      const groups = groupBy(rows, (r) => r.teamId ?? "__none__");
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const orderA = groups[keyA][0]?.teamSortOrder ?? 0;
        const orderB = groups[keyB][0]?.teamSortOrder ?? 0;
        return orderA - orderB || cmp(groups[keyA][0]?.teamName ?? "", groups[keyB][0]?.teamName ?? "");
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const teamName = key === "__none__" ? L.noTeam : (members[0]?.teamName ?? "");
        const teamColor = key === "__none__" ? "#94a3b8" : (members[0]?.teamColor ?? "#3b82f6");
        result.push({ id: `header-team-${key}`, name: teamName, color: teamColor, type: "header" });
        members.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    // Groups alphabetical, members ordered by drag-drop inside each team.
    // (Previous behaviour of the `custom` mode before sort_order was added on teams.)
    case "team-alpha-custom": {
      const groups = groupBy(rows, (r) => r.teamId ?? "__none__");
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = groups[keyA][0]?.teamName ?? "";
        const nameB = groups[keyB][0]?.teamName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const teamName = key === "__none__" ? L.noTeam : (members[0]?.teamName ?? "");
        const teamColor = key === "__none__" ? "#94a3b8" : (members[0]?.teamColor ?? "#3b82f6");
        result.push({ id: `header-team-${key}`, name: teamName, color: teamColor, type: "header" });
        members.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    // BU alphabetical → teams by drag-drop order → members by drag-drop order.
    case "custom-bu-user": {
      const buGroups = groupBy(rows, (r) => r.businessUnitId ?? "__none__");
      const buEntries = Object.entries(buGroups);

      buEntries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = buGroups[keyA][0]?.businessUnitName ?? "";
        const nameB = buGroups[keyB][0]?.businessUnitName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [buKey, buMembers] of buEntries) {
        const buName = buKey === "__none__" ? L.noBu : (buMembers[0]?.businessUnitName ?? "");
        const buColor = buKey === "__none__" ? "#94a3b8" : (buMembers[0]?.businessUnitColor ?? "#8b5cf6");
        result.push({ id: `header-bu-${buKey}`, name: buName, color: buColor, type: "header" });

        const teamGroups = groupBy(buMembers, (r) => r.teamId ?? "__none__");
        const teamEntries = Object.entries(teamGroups);
        teamEntries.sort(([kA], [kB]) => {
          if (kA === "__none__") return 1;
          if (kB === "__none__") return -1;
          const orderA = teamGroups[kA][0]?.teamSortOrder ?? 0;
          const orderB = teamGroups[kB][0]?.teamSortOrder ?? 0;
          return orderA - orderB || cmp(teamGroups[kA][0]?.teamName ?? "", teamGroups[kB][0]?.teamName ?? "");
        });

        for (const [teamKey, teamMembers] of teamEntries) {
          const teamName = teamKey === "__none__" ? L.noTeam : (teamMembers[0]?.teamName ?? "");
          const teamColor = teamKey === "__none__" ? "#94a3b8" : (teamMembers[0]?.teamColor ?? "#3b82f6");
          result.push({ id: `header-bu-${buKey}-team-${teamKey}`, name: `  ${teamName}`, color: teamColor, type: "header" });
          teamMembers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
          result.push(...teamMembers);
        }
      }
      return result;
    }

    // BU → groups (drag-drop order) → projects (drag-drop order)
    case "custom-bu-group": {
      const buGroups = groupBy(rows, (r) => r.businessUnitId ?? "__none__");
      const buEntries = Object.entries(buGroups);

      buEntries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = buGroups[keyA][0]?.businessUnitName ?? "";
        const nameB = buGroups[keyB][0]?.businessUnitName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [buKey, buMembers] of buEntries) {
        const buName = buKey === "__none__" ? L.noBu : (buMembers[0]?.businessUnitName ?? "");
        const buColor = buKey === "__none__" ? "#94a3b8" : (buMembers[0]?.businessUnitColor ?? "#8b5cf6");
        result.push({ id: `header-bu-${buKey}`, name: buName, color: buColor, type: "header" });

        const grpGroups = groupBy(buMembers, (r) => r.groupId ?? "__none__");
        const grpEntries = Object.entries(grpGroups);
        grpEntries.sort(([kA], [kB]) => {
          if (kA === "__none__") return 1;
          if (kB === "__none__") return -1;
          const orderA = grpGroups[kA][0]?.groupSortOrder ?? 0;
          const orderB = grpGroups[kB][0]?.groupSortOrder ?? 0;
          return orderA - orderB || cmp(grpGroups[kA][0]?.groupName ?? "", grpGroups[kB][0]?.groupName ?? "");
        });

        for (const [grpKey, grpMembers] of grpEntries) {
          const grpName = grpKey === "__none__" ? L.noGroup : (grpMembers[0]?.groupName ?? "");
          const grpColor = grpKey === "__none__" ? "#94a3b8" : (grpMembers[0]?.groupColor ?? "#6366f1");
          result.push({ id: `header-bu-${buKey}-grp-${grpKey}`, name: `  ${grpName}`, color: grpColor, type: "header" });
          grpMembers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
          result.push(...grpMembers);
        }
      }
      return result;
    }

    // BU → groups alphabetical → projects alphabetical
    case "custom-bu-group-alpha": {
      const buGroups = groupBy(rows, (r) => r.businessUnitId ?? "__none__");
      const buEntries = Object.entries(buGroups);

      buEntries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = buGroups[keyA][0]?.businessUnitName ?? "";
        const nameB = buGroups[keyB][0]?.businessUnitName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [buKey, buMembers] of buEntries) {
        const buName = buKey === "__none__" ? L.noBu : (buMembers[0]?.businessUnitName ?? "");
        const buColor = buKey === "__none__" ? "#94a3b8" : (buMembers[0]?.businessUnitColor ?? "#8b5cf6");
        result.push({ id: `header-bu-${buKey}`, name: buName, color: buColor, type: "header" });

        const grpGroups = groupBy(buMembers, (r) => r.groupId ?? "__none__");
        const grpEntries = Object.entries(grpGroups);
        grpEntries.sort(([kA], [kB]) => {
          if (kA === "__none__") return 1;
          if (kB === "__none__") return -1;
          return cmp(grpGroups[kA][0]?.groupName ?? "", grpGroups[kB][0]?.groupName ?? "");
        });

        for (const [grpKey, grpMembers] of grpEntries) {
          const grpName = grpKey === "__none__" ? L.noGroup : (grpMembers[0]?.groupName ?? "");
          const grpColor = grpKey === "__none__" ? "#94a3b8" : (grpMembers[0]?.groupColor ?? "#6366f1");
          result.push({ id: `header-bu-${buKey}-grp-${grpKey}`, name: `  ${grpName}`, color: grpColor, type: "header" });
          grpMembers.sort((a, b) => cmp(a.name, b.name));
          result.push(...grpMembers);
        }
      }
      return result;
    }

    // Groups alphabetical, projects ordered by drag-drop inside each group.
    case "group-alpha-custom": {
      const groups = groupBy(rows, (r) => r.groupId ?? "__none__");
      const entries = Object.entries(groups);

      entries.sort(([keyA], [keyB]) => {
        if (keyA === "__none__") return 1;
        if (keyB === "__none__") return -1;
        const nameA = groups[keyA][0]?.groupName ?? "";
        const nameB = groups[keyB][0]?.groupName ?? "";
        return cmp(nameA, nameB);
      });

      const result: GridRow[] = [];
      for (const [key, members] of entries) {
        const groupName = key === "__none__" ? L.noGroup : (members[0]?.groupName ?? "");
        const groupColor = key === "__none__" ? "#94a3b8" : (members[0]?.groupColor ?? "#6366f1");
        result.push({ id: `header-group-${key}`, name: groupName, color: groupColor, type: "header" });
        members.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || cmp(a.name, b.name));
        result.push(...members);
      }
      return result;
    }

    default:
      return rows;
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}
