"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef } from "@tanstack/react-table";
import { useUsers, useDeleteUser, useArchiveUser } from "@/hooks/use-users";
import { useTeams } from "@/hooks/use-teams";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { useQualifications } from "@/hooks/use-qualifications";
import { useRoles, useRoleDisplayName } from "@/hooks/use-roles";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { UserForm } from "@/components/users/user-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { FilterMultiSelect, type FilterItem } from "@/components/shared/filter-multi-select";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Pencil, Trash2, Plus, Archive, ArchiveRestore, Filter, X, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { usePermissions } from "@/hooks/use-permissions";
import { useBuStore } from "@/stores/bu-store";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/shared/error-state";

interface UserRow {
  id: string;
  name: string;
  firstName: string | null;
  displayName?: string;
  username: string | null;
  email: string | null;
  color: string;
  job: string | null;
  active: boolean;
  team?: { id: string; name: string } | null;
  teamId?: string | null;
  businessUnit?: { id: string; name: string } | null;
  businessUnitId?: string | null;
  role?: { id: string; name: string; color?: string | null } | null;
  roleId?: string | null;
  laborType?: { id: string; name: string; initials?: string | null } | null;
  qualifications?: { id: string; name: string; emoji: string; color: string }[];
}

export default function UsersPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const roleName = useRoleDisplayName();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [duplicateFromId, setDuplicateFromId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; active: boolean } | null>(null);
  const [searchValue, setSearchValue] = useState("");

  // Filter states
  const [filterTeamIds, setFilterTeamIds] = useState<string[]>([]);
  const [filterBuIds, setFilterBuIds] = useState<string[]>([]);
  const [filterQualIds, setFilterQualIds] = useState<string[]>([]);
  const [filterRoleIds, setFilterRoleIds] = useState<string[]>([]);
  // Exclusive binary toggle: OFF = active only, ON = inactive only
  const [showInactive, setShowInactive] = useState(false);

  // Always load all users (active + inactive) — the toggle filters client-side.
  // unscoped=true : on /users management page, pages:users grants access to
  // every user in the selected BU regardless of userScope (scope:users_*).
  const { data: users, isLoading } = useUsers(undefined, false, true);
  const deleteUser = useDeleteUser();
  const archiveUser = useArchiveUser();
  const { can, isLoading: permLoading } = usePermissions();
  const { selectedBuIds } = useBuStore();

  // Data for filters
  const { data: allTeams } = useTeams();
  const { data: allBUs } = useBusinessUnits();
  const { data: allQuals } = useQualifications();
  const { data: allRoles } = useRoles();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:users")) return <ErrorState code={403} compact showBack={false} />;

  const hasAnyFilter = filterTeamIds.length + filterBuIds.length + filterQualIds.length + filterRoleIds.length > 0 || showInactive;

  const teamOptions: FilterItem[] = (allTeams ?? []).map((t: any) => ({ id: t.id, name: t.name, color: t.color }));
  const buOptions: FilterItem[] = (allBUs ?? []).map((b: any) => ({ id: b.id, name: b.name, color: null }));
  const qualOptions: FilterItem[] = (allQuals ?? []).map((q: any) => ({ id: q.id, name: q.name, color: q.color }));
  const roleOptions: FilterItem[] = (allRoles ?? []).map((r: any) => ({ id: r.id, name: roleName(r), color: r.color }));

  // Apply filters client-side
  const allUsers = (users as UserRow[]) ?? [];
  const filteredUsers = (() => {
    // Status toggle : exclusive — OFF = only active, ON = only inactive
    let result = allUsers.filter((u) => showInactive ? !u.active : u.active);
    // Global BU filter from header selector
    if (selectedBuIds.length > 0) {
      result = result.filter((u: any) => (u.businessUnitId && selectedBuIds.includes(u.businessUnitId)) || (u.businessUnit?.id && selectedBuIds.includes(u.businessUnit.id)));
    }
    if (filterTeamIds.length > 0) result = result.filter(u => u.team?.id && filterTeamIds.includes(u.team.id));
    if (filterBuIds.length > 0) result = result.filter(u => u.businessUnit?.id && filterBuIds.includes(u.businessUnit.id));
    if (filterQualIds.length > 0) result = result.filter(u => u.qualifications?.some(q => filterQualIds.includes(q.id)));
    if (filterRoleIds.length > 0) result = result.filter(u => u.role?.id && filterRoleIds.includes(u.role.id));
    return result;
  })();

  function openCreate() { setEditId(null); setDuplicateFromId(null); setDialogOpen(true); }
  function openEdit(id: string) { setEditId(id); setDuplicateFromId(null); setDialogOpen(true); }
  function openDuplicate(id: string) { setEditId(null); setDuplicateFromId(id); setDialogOpen(true); }
  function handleDelete(id: string) { setDeleteTarget(id); }
  function clearFilters() {
    setFilterTeamIds([]);
    setFilterBuIds([]);
    setFilterQualIds([]);
    setFilterRoleIds([]);
    setShowInactive(false);
  }

  const columns: ColumnDef<UserRow, any>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("list.columns.name")),
      cell: ({ row }) => {
        const fullName = row.original.firstName ? `${row.original.firstName} ${row.original.name}` : row.original.name;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: row.original.color ?? undefined }} />
            <TruncatedCell value={fullName} maxWidth="max-w-[200px]" className="font-medium" />
          </div>
        );
      },
    },
    {
      accessorKey: "username",
      header: sortableHeader(t("list.columns.login")),
      cell: ({ row }) => <TruncatedCell value={row.original.username} maxWidth="max-w-[140px]" />,
    },
    {
      accessorKey: "email",
      header: sortableHeader(t("list.columns.email")),
      cell: ({ row }) => <TruncatedCell value={row.original.email} maxWidth="max-w-[220px]" />,
    },
    {
      id: "team",
      accessorFn: (row) => row.team?.name,
      header: sortableHeader(t("list.columns.team")),
      cell: ({ row }) => <TruncatedCell value={row.original.team?.name} maxWidth="max-w-[140px]" />,
    },
    {
      id: "role",
      accessorFn: (row) => roleName(row.role),
      header: sortableHeader(t("list.columns.role")),
      cell: ({ row }) => {
        const role = row.original.role;
        if (!role) return "—";
        return (
          <Badge variant="outline" style={role.color ? { borderColor: role.color, color: role.color, backgroundColor: `${role.color}15` } : undefined}>
            {roleName(role)}
          </Badge>
        );
      },
    },
    {
      id: "businessUnit",
      accessorFn: (row) => row.businessUnit?.name,
      header: sortableHeader(t("list.columns.businessUnit")),
      cell: ({ row }) => <TruncatedCell value={row.original.businessUnit?.name} maxWidth="max-w-[140px]" />,
    },
    {
      id: "qualifications",
      header: t("list.columns.qualifications"),
      cell: ({ row }) => {
        const quals = row.original.qualifications;
        if (!quals || quals.length === 0) return "—";
        // Compact display: comma-separated list in foreground text
        // (denser, saves horizontal space vs. colored badges). The
        // colors and icons remain visible in the user edit form.
        return <span className="text-sm">{quals.map((q) => q.name).join(", ")}</span>;
      },
    },
    {
      accessorKey: "job",
      header: sortableHeader(t("list.columns.job")),
      cell: ({ row }) => <TruncatedCell value={row.original.job} maxWidth="max-w-[160px]" />,
    },
    {
      accessorKey: "active",
      header: tc("states.active"),
      cell: ({ row }) => (
        <Badge variant={row.original.active ? "default" : "secondary"}>
          {row.original.active ? tc("states.active") : tc("states.inactive")}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 170,
      cell: ({ row }) => {
        const canDuplicate = can("users:create");
        const duplicateTooltip = canDuplicate ? tc("actions.duplicate") : t("shared.insufficientPermission");
        return (
          <RowActions
            actions={[
              {
                label: tc("actions.edit"),
                icon: <Pencil className="h-4 w-4" />,
                onClick: () => openEdit(row.original.id),
                allowed: can("users:edit"),
              },
              {
                label: duplicateTooltip,
                icon: <Copy className="h-4 w-4 text-blue-500" />,
                onClick: () => openDuplicate(row.original.id),
                allowed: canDuplicate,
                tooltipDisallowed: duplicateTooltip,
              },
              {
                label: row.original.active ? tc("actions.disable") : t("list.actions.reactivate"),
                icon: row.original.active ? <Archive className="h-4 w-4 text-orange-500" /> : <ArchiveRestore className="h-4 w-4 text-emerald-500" />,
                onClick: () => setArchiveTarget({ id: row.original.id, active: !row.original.active }),
                allowed: can("users:edit"),
              },
              {
                label: t("list.actions.deletePermanently"),
                icon: <Trash2 className="h-4 w-4" />,
                onClick: () => handleDelete(row.original.id),
                allowed: can("users:delete"),
                destructive: true,
                separatorBefore: true,
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("list.title")}</h1>
        {!can("users:create") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled><Plus className="h-4 w-4 mr-1" />{tc("actions.add")}</Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("shared.insufficientPermission")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />{tc("actions.add")}</Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <FilterMultiSelect label={t("list.filters.team")} items={teamOptions} selected={filterTeamIds} onChange={setFilterTeamIds} />
        <FilterMultiSelect label={t("list.filters.role")} items={roleOptions} selected={filterRoleIds} onChange={setFilterRoleIds} />
        <FilterMultiSelect label={t("list.filters.businessUnit")} items={buOptions} selected={filterBuIds} onChange={setFilterBuIds} />
        <FilterMultiSelect label={t("list.filters.qualification")} items={qualOptions} selected={filterQualIds} onChange={setFilterQualIds} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowInactive((v) => !v)}
          className={cn(
            "h-8 text-xs gap-1.5",
            showInactive && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300",
          )}
        >
          <Archive className="h-3 w-3" />
          {t("list.filters.inactive")}
        </Button>
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("list.filters.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" />{tc("actions.clear")}
          </Button>
        )}
        <div className="flex-1" />
        {hasAnyFilter && (
          <span className="text-xs text-muted-foreground">
            {t("list.count", { count: filteredUsers.length })}
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredUsers}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        className="flex flex-col gap-3 flex-1 min-h-0"
      />

      {isLoading && <p className="text-center text-muted-foreground">{tc("states.loading")}</p>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editId
                ? t("list.dialog.editTitle")
                : duplicateFromId
                  ? t("list.dialog.duplicateTitle")
                  : t("list.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editId
                ? t("list.dialog.editDescription")
                : duplicateFromId
                  ? t("list.dialog.duplicateDescription")
                  : t("list.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <UserForm
            id={editId}
            duplicateFromId={duplicateFromId}
            onClose={() => setDialogOpen(false)}
            onDelete={() => { if (editId) { setDialogOpen(false); setDeleteTarget(editId); } }}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title={archiveTarget?.active ? t("list.archive.reactivateTitle") : t("list.archive.deactivateTitle")}
        description={archiveTarget?.active
          ? t("list.archive.reactivateDescription")
          : t("list.archive.deactivateDescription")}
        onConfirm={() => { if (archiveTarget) archiveUser.mutate(archiveTarget, { onSuccess: () => setArchiveTarget(null) }); }}
        isPending={archiveUser.isPending}
        confirmLabel={archiveTarget?.active ? t("list.archive.reactivateConfirm") : t("list.archive.deactivateConfirm")}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("list.delete.title")}
        description={t("list.delete.description")}
        onConfirm={() => { if (deleteTarget) deleteUser.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) }); }}
        isPending={deleteUser.isPending}
        variant="danger"
      />
    </div>
  );
}
