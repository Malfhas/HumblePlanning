"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef } from "@tanstack/react-table";
import { useResources, useDeleteResource } from "@/hooks/use-resources";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { ResourceForm } from "@/components/resources/resource-form";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { FilterMultiSelect, type FilterItem } from "@/components/shared/filter-multi-select";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Pencil, Trash2, Plus, Filter, X, Archive } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { ErrorState } from "@/components/shared/error-state";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import { useBuStore } from "@/stores/bu-store";
import { ModuleGuard } from "@/components/shared/module-guard";
import { useDateFormat } from "@/hooks/use-date-format";
import type { ResourceWithType } from "@/types";

const STATUS_BADGES: Record<string, { labelKey: "available" | "maintenance" | "outOfService"; className: string }> = {
  available: { labelKey: "available", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  maintenance: { labelKey: "maintenance", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  out_of_service: { labelKey: "outOfService", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export default function ResourcesPage() {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<ResourceWithType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showOutOfService, setShowOutOfService] = useState(false);
  const [filterTypeIds, setFilterTypeIds] = useState<string[]>([]);
  const [filterStatusIds, setFilterStatusIds] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState("");

  const { data: resources } = useResources(true);
  const deleteResource = useDeleteResource();
  const { can, isLoading: permLoading } = usePermissions();
  const { selectedBuIds } = useBuStore();

  const typeOptions = useMemo<FilterItem[]>(() => {
    if (!resources) return [];
    const map = new Map<string, FilterItem>();
    for (const r of resources) {
      if (r.resourceType && !map.has(r.resourceType.id)) {
        map.set(r.resourceType.id, { id: r.resourceType.id, name: r.resourceType.name, color: r.resourceType.color });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, intlTag));
  }, [resources, intlTag]);

  const statusOptions: FilterItem[] = [
    { id: "available", name: t("status.available"), color: "#22c55e" },
    { id: "maintenance", name: t("status.maintenance"), color: "#f59e0b" },
  ];

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:resources")) return <ErrorState code={403} compact showBack={false} />;

  const filteredResources = (resources ?? []).filter((r) => {
    // BU store filter (global BU selector)
    if (selectedBuIds.length > 0 && (!r.businessUnitId || !selectedBuIds.includes(r.businessUnitId))) return false;
    const isOos = r.status === "out_of_service";
    if (showOutOfService ? !isOos : isOos) return false;
    if (filterTypeIds.length > 0 && (!r.resourceType || !filterTypeIds.includes(r.resourceType.id))) return false;
    if (filterStatusIds.length > 0 && !filterStatusIds.includes(r.status)) return false;
    return true;
  });

  const hasAnyFilter = filterTypeIds.length + filterStatusIds.length > 0 || showOutOfService;

  function clearFilters() {
    setFilterTypeIds([]);
    setFilterStatusIds([]);
    setShowOutOfService(false);
  }

  function openCreate() { setEditData(null); setDialogOpen(true); }
  function openEdit(resource: ResourceWithType) { setEditData(resource); setDialogOpen(true); }

  const columns: ColumnDef<ResourceWithType, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("list.columns.name")),
      cell: ({ row }) => <TruncatedCell value={row.original.name} maxWidth="max-w-[200px]" className="font-medium" />,
    },
    {
      accessorKey: "resourceType",
      header: sortableHeader(t("list.columns.type")),
      cell: ({ row }) => {
        const rt = row.original.resourceType;
        if (!rt) return <span className="text-muted-foreground">—</span>;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium max-w-[160px] truncate"
                style={{ backgroundColor: rt.color, color: contrastColor(rt.color) }}
              >
                <QualificationIcon name={rt.icon} className="size-3.5 shrink-0" />
                <span className="truncate">{rt.name}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{rt.name}</TooltipContent>
          </Tooltip>
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
      accessorKey: "serialNumber",
      header: sortableHeader(t("list.columns.serialNumber")),
      cell: ({ row }) => <TruncatedCell value={row.original.serialNumber} maxWidth="max-w-[140px]" className="text-muted-foreground" />,
    },
    {
      accessorKey: "status",
      header: sortableHeader(t("list.columns.status")),
      cell: ({ row }) => {
        const badge = STATUS_BADGES[row.original.status] || STATUS_BADGES.available;
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
            {t(`status.${badge.labelKey}`)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 92,
      cell: ({ row }) => (
        <RowActions
          actions={[
            { label: tc("actions.edit"), icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(row.original), allowed: can("resources:edit") },
            { label: tc("actions.delete"), icon: <Trash2 className="h-4 w-4" />, onClick: () => setDeleteTarget(row.original.id), allowed: can("resources:delete"), destructive: true, separatorBefore: true },
          ]}
        />
      ),
    },
  ];

  return (
    <ModuleGuard configKey="MODULE_RESOURCES">
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tc("entities.resources")}</h1>
        {!can("resources:create") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled>
                  <Plus className="h-4 w-4 mr-1" /> {tc("actions.add")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("list.permissionDenied")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {tc("actions.add")}
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <FilterMultiSelect label={t("list.columns.type")} items={typeOptions} selected={filterTypeIds} onChange={setFilterTypeIds} />
        <FilterMultiSelect label={t("list.columns.status")} items={statusOptions} selected={filterStatusIds} onChange={setFilterStatusIds} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowOutOfService((v) => !v)}
          className={cn(
            "h-8 text-xs gap-1.5",
            showOutOfService && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300",
          )}
        >
          <Archive className="h-3 w-3" />
          {t("list.outOfService")}
        </Button>
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("resources.searchPlaceholder")}
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
            {t("resources.count", { count: filteredResources.length })}
          </span>
        )}
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={filteredResources}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editData ? t("resources.dialog.editTitle") : t("resources.dialog.createTitle")}</DialogTitle>
            <DialogDescription>
              {editData ? t("resources.dialog.editDescription") : t("resources.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <ResourceForm initialData={editData} onClose={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("resources.confirmDelete.title")}
        description={t("resources.confirmDelete.description")}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteResource.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteResource.isPending}
      />
    </div>
    </ModuleGuard>
  );
}
