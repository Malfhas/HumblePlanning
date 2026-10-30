"use client";

import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useProjects, useProject, useDeleteProject, useUpdateProject } from "@/hooks/use-projects";
import type { ProjectWithRelations } from "@/types";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { ProjectForm } from "@/components/projects/project-form";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// Switch/Label replaced by a toggle button after the Statut filter
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus, Archive, ArchiveRestore, X, HardHat, Filter, Copy } from "lucide-react";
import { LaborBudgetDialog } from "@/components/projects/labor-budget-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PermissionButton } from "@/components/shared/permission-button";
import { RowActions } from "@/components/shared/row-actions";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { FilterMultiSelect, type FilterItem } from "@/components/shared/filter-multi-select";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import { useBuStore } from "@/stores/bu-store";
import { ErrorState } from "@/components/shared/error-state";
import { useTranslations } from "next-intl";
import { hasDyn, tDyn } from "@/i18n/dynamic";

// i18n-dynamic: projects.status.*

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  archived: "bg-yellow-100 text-yellow-700",
};

type Project = ProjectWithRelations;

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const statusLabel = (status: string) => (hasDyn(t, `status.${status}`) ? tDyn(t, `status.${status}`) : status);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [duplicateFromId, setDuplicateFromId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; currentStatus: string } | null>(null);
  const [laborBudgetTarget, setLaborBudgetTarget] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterBusinessUnits, setFilterBusinessUnits] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState("");

  const { selectedBuIds } = useBuStore();
  const { can, isLoading: permLoading } = usePermissions();

  // Always load all projects (archived + non-archived) — toggle filters client-side
  // unscoped=true : on /projects management page, pages:projects grants access to
  // every project in the selected BU regardless of planning scopes (scope:projects_*).
  const { data: projects, isLoading } = useProjects(undefined, true, true);

  /**
   * Projects restricted to the currently selected BU (top-left selector).
   * Used as the source of truth for building filter dropdown options, so
   * dropdowns never show items that belong to a BU the user has excluded.
   * The underlying `projects` list is already scope-filtered by the backend
   * (/api/projects applies getVisibleProjectIds), so permissions are inherited.
   */
  const projectsInBu = useMemo<Project[]>(() => {
    if (!projects) return [];
    if (selectedBuIds.length === 0) return projects as Project[];
    return (projects as Project[]).filter((p) => {
      const buId = (p as any).businessUnitId ?? (p as any).businessUnit?.id ?? null;
      return buId ? selectedBuIds.includes(buId) : false;
    });
  }, [projects, selectedBuIds]);

  const groupOptions = useMemo<FilterItem[]>(() => {
    const map = new Map<string, FilterItem>();
    for (const p of projectsInBu) {
      if (p.group && !map.has(p.group.id)) {
        map.set(p.group.id, { id: p.group.id, name: p.group.name, color: p.group.color ?? null });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projectsInBu]);

  const businessUnitOptions = useMemo<FilterItem[]>(() => {
    const map = new Map<string, FilterItem>();
    for (const p of projectsInBu) {
      const bu = (p as any).businessUnit;
      if (bu && !map.has(bu.id)) {
        map.set(bu.id, { id: bu.id, name: bu.name, color: bu.color ?? null });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projectsInBu]);

  const ownerOptions = useMemo<FilterItem[]>(() => {
    // List all owners of currently-visible projects (already scope/BU filtered).
    // No extra userScope filtering here — the goal is to let the user filter any
    // visible project by its owner; hiding the owner would make the filter useless
    // for that row.
    const map = new Map<string, FilterItem>();
    for (const p of projectsInBu) {
      if (!p.owner || map.has(p.owner.id)) continue;
      map.set(p.owner.id, { id: p.owner.id, name: [p.owner.firstName, p.owner.name].filter(Boolean).join(" "), color: null });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projectsInBu]);

  // Archived is handled by the separate toggle button, not this filter
  const statusFilterOptions: FilterItem[] = [
    { id: "todo", name: t("status.todo"), color: "#9ca3af" },
    { id: "in_progress", name: t("status.in_progress"), color: "#3b82f6" },
    { id: "done", name: t("status.done"), color: "#22c55e" },
  ];

  const hasAnyFilter = filterGroups.length + filterBusinessUnits.length + filterOwners.length + filterStatuses.length > 0 || showArchived;

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return (projects as Project[]).filter((p) => {
      // Archive toggle : exclusive — OFF = non-archived only, ON = archived only
      const isArchived = p.status === "archived";
      if (showArchived ? !isArchived : isArchived) return false;
      // Global BU filter from header selector
      if (selectedBuIds.length > 0) {
        if (!((p as any).businessUnitId && selectedBuIds.includes((p as any).businessUnitId)) && !((p as any).businessUnit?.id && selectedBuIds.includes((p as any).businessUnit.id))) return false;
      }
      if (filterGroups.length > 0 && (!p.group || !filterGroups.includes(p.group.id))) return false;
      if (filterBusinessUnits.length > 0 && (!(p as any).businessUnit || !filterBusinessUnits.includes((p as any).businessUnit.id))) return false;
      if (filterOwners.length > 0 && (!p.owner || !filterOwners.includes(p.owner.id))) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(p.status)) return false;
      return true;
    });
  }, [projects, selectedBuIds, filterGroups, filterBusinessUnits, filterOwners, filterStatuses, showArchived]);

  const { data: targetProject } = useProject(deleteTarget);
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:projects")) return <ErrorState code={403} compact showBack={false} />;

  function openCreate() {
    setEditId(null);
    setDuplicateFromId(null);
    setDialogOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setDuplicateFromId(null);
    setDialogOpen(true);
  }

  function openDuplicate(id: string) {
    setEditId(null);
    setDuplicateFromId(id);
    setDialogOpen(true);
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteProject.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  function handleArchive() {
    if (!deleteTarget) return;
    updateProject.mutate(
      { id: deleteTarget, data: { status: "archived" } },
      { onSuccess: () => setDeleteTarget(null) },
    );
  }

  function handleConfirmToggleArchive() {
    if (!archiveTarget) return;
    const newStatus = archiveTarget.currentStatus === "archived" ? "todo" : "archived";
    updateProject.mutate(
      { id: archiveTarget.id, data: { status: newStatus } },
      { onSuccess: () => setArchiveTarget(null) },
    );
  }

  function clearFilters() {
    setFilterGroups([]);
    setFilterBusinessUnits([]);
    setFilterOwners([]);
    setFilterStatuses([]);
    setShowArchived(false);
  }

  const taskCount = targetProject?.taskCount ?? 0;
  const hasOnArchive = taskCount > 0;

  const columns: ColumnDef<Project, any>[] = [
    {
      accessorKey: "businessNumber",
      header: sortableHeader(t("fields.businessNumberShort")),
      cell: ({ row }) => <TruncatedCell value={row.original.businessNumber} maxWidth="max-w-[120px]" className="text-muted-foreground" />,
    },
    {
      accessorKey: "name",
      header: sortableHeader(t("fields.name")),
      cell: ({ row }) => (
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: row.original.color ?? undefined }}
          />
          <TruncatedCell value={row.original.name} maxWidth="max-w-[220px]" className="font-medium" />
          {row.original.status === "archived" && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-300 text-xs shrink-0">
              {t("status.archived")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "group",
      accessorFn: (row) => row.group?.name,
      header: sortableHeader(t("fields.group")),
      cell: ({ row }) => {
        const group = row.original.group;
        if (!group) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            {group.color && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: group.color ?? undefined }}
              />
            )}
            <TruncatedCell value={group.name} maxWidth="max-w-[160px]" />
          </div>
        );
      },
    },
    {
      id: "businessUnit",
      accessorFn: (row) => (row as any).businessUnit?.name,
      header: sortableHeader(t("fields.businessUnit")),
      cell: ({ row }) => {
        const bu = (row.original as any).businessUnit;
        if (!bu) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            {bu.color && <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: bu.color }} />}
            <TruncatedCell value={bu.name} maxWidth="max-w-[160px]" />
          </div>
        );
      },
    },
    {
      id: "owner",
      accessorFn: (row) => row.owner ? [row.owner.firstName, row.owner.name].filter(Boolean).join(" ") : undefined,
      header: sortableHeader(t("fields.owner")),
      cell: ({ row }) => {
        const ownerName = row.original.owner ? [row.original.owner.firstName, row.original.owner.name].filter(Boolean).join(" ") : null;
        return <TruncatedCell value={ownerName} maxWidth="max-w-[180px]" />;
      },
    },
    {
      accessorKey: "status",
      header: sortableHeader(t("fields.status")),
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              STATUS_COLORS[status] ?? ""
            }`}
          >
            {statusLabel(status)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 200,
      cell: ({ row }) => {
        const isArchived = row.original.status === "archived";
        return (
          <RowActions
            actions={[
              {
                label: t("list.actions.laborBudgets"),
                icon: <HardHat className="h-4 w-4 text-amber-600" />,
                onClick: () => setLaborBudgetTarget(row.original.id),
                allowed: can("pages:projects"),
              },
              {
                label: tc("actions.edit"),
                icon: <Pencil className="h-4 w-4" />,
                onClick: () => openEdit(row.original.id),
                allowed: can("projects:edit"),
              },
              {
                label: tc("actions.duplicate"),
                icon: <Copy className="h-4 w-4 text-blue-500" />,
                onClick: () => openDuplicate(row.original.id),
                allowed: can("projects:create"),
              },
              {
                label: isArchived ? tc("actions.unarchive") : tc("actions.archive"),
                icon: isArchived
                  ? <ArchiveRestore className="h-4 w-4 text-green-600" />
                  : <Archive className="h-4 w-4 text-orange-500" />,
                onClick: () => setArchiveTarget({ id: row.original.id, currentStatus: row.original.status }),
                allowed: can("projects:archive"),
              },
              {
                label: tc("actions.delete"),
                icon: <Trash2 className="h-4 w-4" />,
                onClick: () => setDeleteTarget(row.original.id),
                allowed: can("projects:delete"),
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
        <h1 className="text-2xl font-bold">{tc("entities.projects")}</h1>
        {!can("projects:create") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled><Plus className="h-4 w-4 mr-1" />{tc("actions.add")}</Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("permissionDenied")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />{tc("actions.add")}</Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <FilterMultiSelect label={t("fields.group")} items={groupOptions} selected={filterGroups} onChange={setFilterGroups} />
        <FilterMultiSelect label={t("fields.businessUnit")} items={businessUnitOptions} selected={filterBusinessUnits} onChange={setFilterBusinessUnits} />
        <FilterMultiSelect label={t("fields.owner")} items={ownerOptions} selected={filterOwners} onChange={setFilterOwners} />
        <FilterMultiSelect label={t("fields.status")} items={statusFilterOptions} selected={filterStatuses} onChange={setFilterStatuses} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
          className={cn(
            "h-8 text-xs gap-1.5",
            showArchived && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300",
          )}
        >
          <Archive className="h-3 w-3" />
          {t("list.archivedToggle")}
        </Button>
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("list.searchPlaceholder")}
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
            {t("list.count", { count: filteredProjects.length })}
          </span>
        )}
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={filteredProjects}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {isLoading && (
        <p className="text-center text-muted-foreground">{tc("states.loading")}</p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editId
                ? t("dialog.editTitle")
                : duplicateFromId
                  ? t("dialog.duplicateTitle")
                  : t("dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editId
                ? t("dialog.editDescription")
                : duplicateFromId
                  ? t("dialog.duplicateDescription")
                  : t("dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            id={editId}
            duplicateFromId={duplicateFromId}
            onClose={() => setDialogOpen(false)}
            onDelete={editId ? () => {
              setDialogOpen(false);
              setDeleteTarget(editId);
            } : undefined}
            onArchive={editId ? (currentStatus) => {
              const newStatus = currentStatus === "archived" ? "todo" : "archived";
              updateProject.mutate(
                { id: editId, data: { status: newStatus } },
                { onSuccess: () => setDialogOpen(false) },
              );
            } : undefined}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title={archiveTarget?.currentStatus === "archived" ? t("archiveDialog.unarchiveTitle") : t("archiveDialog.archiveTitle")}
        description={archiveTarget?.currentStatus === "archived"
          ? t("archiveDialog.unarchiveDescription")
          : t("archiveDialog.archiveDescription")}
        onConfirm={handleConfirmToggleArchive}
        isPending={updateProject.isPending}
        confirmLabel={archiveTarget?.currentStatus === "archived" ? tc("actions.unarchive") : tc("actions.archive")}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("confirmDelete.title")}
        description={
          hasOnArchive
            ? t("confirmDelete.withTasks", { count: taskCount })
            : t("confirmDelete.noTasks")
        }
        onConfirm={handleConfirmDelete}
        onArchive={hasOnArchive ? handleArchive : undefined}
        isPending={deleteProject.isPending || updateProject.isPending}
        variant="danger"
      />

      <LaborBudgetDialog
        projectId={laborBudgetTarget}
        onClose={() => setLaborBudgetTarget(null)}
      />
    </div>
  );
}
